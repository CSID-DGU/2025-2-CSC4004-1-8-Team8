const mongoose = require('mongoose');
const axios = require('axios');
const kgraphSchema = require('~/models/schema/kgraph');

const KGraph = mongoose.model('KGraph', kgraphSchema);

const EMBED_URL = process.env.PYTHON_EMBED_URL || 'http://localhost:8000/embed';
// NOTE: `createKGraph` was removed. Graph creation should be handled by
// explicit application logic (e.g. via a controller/service) to avoid
// implicit side-effects like automatic embedding or background upserts.
// If you need a small helper to create graphs and schedule embedding,
// implement it in a higher-level module where creation intent is explicit.

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

const deleteKGraph = async (id) => {
  return await KGraph.findByIdAndDelete(id);
};

module.exports = {
  KGraph,
  addNodeToUserGraph,
  getEntireGraph,
  updateKGraph,
  deleteKGraph,
};