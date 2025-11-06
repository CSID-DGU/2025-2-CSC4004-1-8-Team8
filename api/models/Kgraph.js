const mongoose = require('mongoose');
const axios = require('axios');
const kgraphSchema = require('~/models/schema/kgraph');

const KGraph = mongoose.model('KGraph', kgraphSchema);

const EMBED_URL = process.env.PYTHON_EMBED_URL || 'http://localhost:8000/embed';

/**
 * Add a node into the KGraph that belongs to a specific user.
 * Ensures ownership by filtering on the `user` field and performs an upsert
 * if the user's kgraph document does not yet exist.
 * The function generates a server-side _id for the new node so the inserted
 * subdocument can be unambiguously identified in the returned document.
 *
 * @param {mongoose.Types.ObjectId|string} userId
 * @param {Object} newNodeData - node fields (x,y,label...). _id will be created if absent.
 * @returns {{ graph: Document, node: Object }} - updated graph and the inserted node
 */
const addNodeToUserGraph = async (userId, newNodeData) => {
  const ObjectId = mongoose.Types.ObjectId;

  // normalize userId to ObjectId when possible
  let ownerId = ObjectId(userId);

  // ensure node has an _id so we can find it reliably after update
  if (!newNodeData._id) {
    newNodeData._id = new ObjectId();
  }

  const now = new Date();
  newNodeData.createdAt = newNodeData.createdAt || now;
  newNodeData.updatedAt = newNodeData.updatedAt || now;

  const filter = { user: ownerId };
  const update = {
    $push: { nodes: newNodeData },
    // if a new document is created via upsert, ensure the user field is set
    $setOnInsert: { user: ownerId, createdAt: now, updatedAt: now },
  };
  const options = { new: true, upsert: true };

  //user 단위 document
  const updated = await KGraph.findOneAndUpdate(filter, update, options).exec();
  if (!updated) {
    throw new Error('Failed to add node: ownership check failed or write error');
  }

  const added = (updated.nodes || []).find((n) => String(n._id) === String(newNodeData._id));

  // fire-and-forget: send the newly-added node to the embed service
  try {
    const userIdStr = String(ownerId);

    const nodePayload = {
      id: added && (added.id || String(added._id || '')),
      content: added && typeof added.content === 'string' ? added.content : '',

    };

    setImmediate(async () => {
      try {
        await axios.post(EMBED_URL, { user_id: userIdStr, nodes: [nodePayload] }, { timeout: 15000 });
      } catch (err) {
        console.error('[KGraph] embed call failed for addNodeToUserGraph:', err?.message || err);
      } // TODO: 비정상 응답 처리 로직 필요
    });
  } catch (e) {
    console.error('[KGraph] failed scheduling embed call:', e?.message || e);
  }

  return { graph: updated, node: added };
};

// TODO: 전체 그래프 일괄 반환 로직

/**
 * @param {mongoose.Types.ObjectId|string} userId
 * @returns
 */
const getEntireGraph = async (userId) => {
  return await KGraph.findById(userId);
};

const updateKGraph = async (id, updates) => {
  //TODO: 좌표 업데이트, 라벨 업데이트, content 업데이트(이때는 embedding도 다시 수행해야 함), 등, + update timestamp 설정하기.
  return await KGraph.findByIdAndUpdate(id, updates, { new: true });
};

const deleteUserKGraph = async (id) => {
  return await KGraph.findByIdAndDelete(id);
};

const deleteNodes = async (userId, nodeId) => {

  // nodeId can be a single id or an array of ids
  const ObjectId = mongoose.Types.ObjectId;

  const ownerId = ObjectId(userId);

  const ids = Array.isArray(nodeId) ? nodeId : [nodeId];
  const convertedIds = ids.map((id) => {
    try {
      return ObjectId(id);
    } catch (e) {
      // fall back to raw value (string)
      return String(id);
    }
  });

  // Pull nodes whose _id is in the list
  const updated = await KGraph.findOneAndUpdate(
    { user: ownerId },
    { $pull: { nodes: { _id: { $in: convertedIds } } } },
    { new: true }
  ).exec();

  if (!updated) {
    throw new Error('Failed to delete nodes: user graph not found or write error');
  }

  // Also remove any edges that reference the deleted node ids (source/target stored as strings)
  try {
    const idStrings = convertedIds.map((i) => String(i));
    await KGraph.updateOne(
      { user: ownerId },
      { $pull: { edges: { $or: [{ source: { $in: idStrings } }, { target: { $in: idStrings } }] } } }
    ).exec();
  } catch (e) {
    // best-effort; log but don't fail the operation
    console.error('[KGraph] failed removing edges referencing deleted nodes:', e?.message || e);
  }

  // Fire-and-forget: request the embed worker to delete corresponding vectors
  try {
    const idStrings = convertedIds.map((i) => String(i));
    const userIdStr = String(ownerId);
    setImmediate(async () => {
      try {
        const url = EMBED_URL.endsWith('/delete') ? EMBED_URL : `${EMBED_URL}/delete`;
        await axios.post(url, { user_id: userIdStr, ids: idStrings }, { timeout: 15000 });
      } catch (err) {
        // log http error details if available
        try {
          if (err && err.response) {
            console.error('[KGraph] embed delete failed', { status: err.response.status, data: err.response.data });
          } else {
            console.error('[KGraph] embed delete failed:', err?.message || err);
          }
        } catch (logErr) {
          console.error('[KGraph] embed delete failed and logging failed:', logErr?.message || logErr);
        }
      }
    });
  } catch (e) {
    console.error('[KGraph] failed scheduling embed delete call:', e?.message || e);
  }

  return updated;

};

const deleteEdges = async (userId, edgeId) => {
  const ObjectId = mongoose.Types.ObjectId;
  const ownerId = ObjectId(userId);
  const ids = Array.isArray(edgeId) ? edgeId : [edgeId];
  const converted = ids.map((id) => {
    try {
      return ObjectId(id);
    } catch (e) {
      return String(id);
    }
  });

  const updated = await KGraph.findOneAndUpdate(
    { user: ownerId },
    { $pull: { edges: { _id: { $in: converted } } } },
    { new: true }
  ).exec();

  if (!updated) {
    throw new Error('Failed to delete edges: user graph not found or write error');
  }

  return updated;
};
module.exports = {
  KGraph,
  addNodeToUserGraph,
  getEntireGraph,
  updateKGraph,
  deleteUserKGraph,
  deleteNodes,
  deleteEdges,
};