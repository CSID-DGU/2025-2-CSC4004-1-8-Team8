/**
 * [MERGED FILE]
 * kGraph.js와 Kgraph.js의 기능을 병합한 파일입니다.
 *
 * 기준: kGraph.js (API 엔드포인트와 일치하는 함수 구조)
 * 통합된 기능:
 * 1. Kgraph.js의 Python 임베딩 서비스 연동 (axios, EMBED_URL)
 * 2. models/schema/kgraphSchema.js 스키마 호환성 (content 필드, label: [String] 등)
 */

const mongoose = require('mongoose');
const axios = require('axios');
// kgraphSchema.js (정식 스키마)를 사용합니다.
const kgraphSchema = require('./schema/kgraphSchema');
const { Message } = require('./Message'); // 2.3 API (가져오기)에 필요
const logger = require('~/config/winston');

// Python 임베딩 서비스 URL
const EMBED_URL = process.env.PYTHON_EMBED_URL || 'http://localhost:8000/embed';

// 스키마를 'KGraph'라는 이름의 모델로 등록합니다.
const KGraph = mongoose.model('KGraph', kgraphSchema);

/**
 * 사용자의 지식 그래프 문서를 찾거나, 없으면 새로 생성합니다.
 * kgraphSchema는 사용자 ID당 하나의 문서를 갖습니다.
 * @param {string} userId - 사용자 ID
 * @returns {Promise<Document>} Mongoose KGraph Document
 */
const getOrCreateGraphDoc = async (userId) => {
  if (!userId) {
    logger.error('[KGraph] getOrCreateGraphDoc: userId가 제공되지 않았습니다.');
    throw new Error('User ID is required');
  }

  // [수정됨] KGraph.findOne({ userId }) 사용 (KGraph.js의 findById(userId)는 스키마와 맞지 않음)
  let graph = await KGraph.findOne({ userId });

  if (!graph) {
    logger.info(`[KGraph] 새 그래프 생성 (userId: ${userId})`);
    // [수정됨] new KGraph()로 새 문서를 생성합니다.
    graph = new KGraph({ userId, nodes: [], edges: [] });
    await graph.save();
  }

  return graph;
};

/**
 * (API 4.1) GET /graph
 * 사용자의 전체 지식 그래프 (노드 및 엣지)를 조회합니다.
 * @param {string} userId - 사용자 ID
 * @returns {Promise<{nodes: Array, edges: Array}>}
 */
const getGraph = async (userId) => {
  try {
    const graph = await getOrCreateGraphDoc(userId);

    // Mongoose Sub-document의 _id를 id로 변환하여 프론트엔드에 전달
    const nodes = graph.nodes.map((n) => ({ ...n.toObject(), id: n._id.toString() }));
    const edges = graph.edges.map((e) => ({ ...e.toObject(), id: e._id.toString() }));

    return { nodes, edges };
  } catch (error) {
    logger.error(`[KGraph] Error in getGraph (userId: ${userId})`, error);
    throw new Error('지식 그래프 조회에 실패했습니다.');
  }
};

/**
 * [MERGED] (API 2.1) POST /nodes
 * 단일 노드를 생성합니다. (임베딩 서비스 호출 포함)
 * @param {string} userId - 사용자 ID
 * @param {object} nodeData - { label, x, y, content, source_message_id, source_conversation_id }
 * @returns {Promise<object>} 생성된 노드 객체 (id 포함)
 */
const createNode = async (
  userId,
  { label, x, y, content, source_message_id, source_conversation_id },
) => {
  try {
    const graph = await getOrCreateGraphDoc(userId);

    const newNode = {
      // kgraphSchema.js 스키마에 맞게 수정
      content: content || '', // 'idea_text' -> 'content'
      label: label ? (Array.isArray(label) ? label : [label]) : [], // 'label'을 배열로 처리
      x: x || 0,
      y: y || 0,
      source_message_id: source_message_id || null,
      source_conversation_id: source_conversation_id || null,
      // vector_ref 필드 제거 (임베딩 서비스가 관리)
    };

    graph.nodes.push(newNode); // 배열에 새 노드 추가
    await graph.save();

    const createdNode = graph.nodes[graph.nodes.length - 1];
    const nodeForFrontend = { ...createdNode.toObject(), id: createdNode._id.toString() };

    // [MERGED] Kgraph.js의 임베딩 서비스 호출 로직 (fire-and-forget)
    try {
      const nodePayload = {
        id: nodeForFrontend.id,
        content: nodeForFrontend.content,
      };

      setImmediate(async () => {
        try {
          await axios.post(
            EMBED_URL,
            { user_id: userId, nodes: [nodePayload] },
            { timeout: 15000 },
          );
          logger.info(`[KGraph] Embed call success for new node (userId: ${userId}, nodeId: ${nodeForFrontend.id})`);
        } catch (err) {
          logger.error(`[KGraph] Embed call failed for createNode (nodeId: ${nodeForFrontend.id}):`, err?.message || err);
        }
      });
    } catch (e) {
      logger.error(`[KGraph] Failed scheduling embed call for createNode (nodeId: ${nodeForFrontend.id}):`, e?.message || e);
    }

    return nodeForFrontend;
  } catch (error) {
    logger.error(`[KGraph] Error in createNode (userId: ${userId})`, error);
    throw new Error('노드 생성에 실패했습니다.');
  }
};

/**
 * [MERGED] (API 2.2) PATCH /nodes/{nodeId}
 * 단일 노드의 정보를 (부분) 수정합니다. (필요시 임베딩 서비스 호출 포함)
 * @param {string} userId - 사용자 ID
 * @param {string} nodeId - 수정할 노드의 _id
 * @param {object} updateData - { label, x, y, content, ... } (모두 선택적)
 * @returns {Promise<object>} 수정된 노드 객체
 */
const updateNode = async (
  userId,
  nodeId,
  { label, x, y, content, source_message_id, source_conversation_id },
) => {
  try {
    const graph = await getOrCreateGraphDoc(userId);
    const node = graph.nodes.id(nodeId); // Sub-document ID로 찾기

    if (!node) {
      throw new Error('수정할 노드를 찾을 수 없습니다.');
    }

    let contentChanged = false;

    // 제공된 필드만 업데이트
    if (label !== undefined) {
      // kgraphSchema.js 스키마에 맞게 수정
      node.label = Array.isArray(label) ? label : [label];
    }
    if (x !== undefined) {
      node.x = x;
    }
    if (y !== undefined) {
      node.y = y;
    }
    // 'idea_text' -> 'content'
    if (content !== undefined) {
      node.content = content;
      contentChanged = true;
    }
    // vector_ref 필드 제거
    if (source_message_id !== undefined) {
      node.source_message_id = source_message_id;
    }
    if (source_conversation_id !== undefined) {
      node.source_conversation_id = source_conversation_id;
    }

    await graph.save();

    const updatedNode = { ...node.toObject(), id: node._id.toString() };

    // [MERGED] Kgraph.js의 임베딩 서비스 호출 로직 (content가 변경된 경우에만)
    if (contentChanged) {
      try {
        const nodePayload = {
          id: updatedNode.id,
          content: updatedNode.content,
        };

        setImmediate(async () => {
          try {
            await axios.post(
              EMBED_URL,
              { user_id: userId, nodes: [nodePayload] },
              { timeout: 15000 },
            );
            logger.info(`[KGraph] Embed call success for updated node (userId: ${userId}, nodeId: ${updatedNode.id})`);
          } catch (err) {
            logger.error(`[KGraph] Embed call failed for updateNode (nodeId: ${updatedNode.id}):`, err?.message || err);
          }
        });
      } catch (e) {
        logger.error(`[KGraph] Failed scheduling embed call for updateNode (nodeId: ${updatedNode.id}):`, e?.message || e);
      }
    }

    return updatedNode;
  } catch (error) {
    logger.error(`[KGraph] Error in updateNode (userId: ${userId}, nodeId: ${nodeId})`, error);
    throw new Error('노드 수정에 실패했습니다.');
  }
};

/**
 * [MERGED] (API 2.3) POST /nodes/batch
 * 특정 메시지의 임시 노드들을 지식 그래프로 일괄 가져오기. (임베딩 서비스 호출 포함)
 * @param {string} userId - 사용자 ID
 * @param {string} messageId - 임시 노드를 포함한 메시지 ID
 * @returns {Promise<Array>} 추가된 노드 객체의 배열
 */
const importNodes = async (userId, { messageId }) => {
  try {
    const message = await Message.findOne({ messageId, user: userId });

    if (!message) {
      throw new Error('임시 노드를 가져올 메시지를 찾을 수 없습니다.');
    }
    if (message.isImported) {
      throw new Error('이미 가져오기가 완료된 메시지입니다.');
    }
    if (!message.nodes || message.nodes.length === 0) {
      throw new Error('가져올 임시 노드가 없습니다.');
    }

    const graph = await getOrCreateGraphDoc(userId);

    // [MERGED] kgraphSchema.js 스키마에 맞게 수정
    // content는 필수 필드이므로, 임시 노드의 label을 content로 사용
    const newNodes = message.nodes.map((tn) => ({
      content: tn.label || '새 노드', // 'content' 필드 추가
      label: tn.label ? [tn.label] : [], // 'label'을 배열로
      x: tn.x || 0,
      y: tn.y || 0,
    }));

    graph.nodes.push(...newNodes);
    message.isImported = true; // 가져오기 완료 플래그 설정

    // 두 문서(그래프, 메시지)를 동시에 저장
    await Promise.all([graph.save(), message.save()]);

    // 방금 추가된 노드들을 반환 (ID 포함)
    const addedNodes = graph.nodes.slice(-newNodes.length);
    const addedNodesForFrontend = addedNodes.map((n) => ({
      ...n.toObject(),
      id: n._id.toString(),
    }));

    // [MERGED] Kgraph.js의 임베딩 서비스 호출 로직 (일괄)
    try {
      const nodesPayload = addedNodesForFrontend.map(n => ({
        id: n.id,
        content: n.content,
      }));

      setImmediate(async () => {
        try {
          await axios.post(
            EMBED_URL,
            { user_id: userId, nodes: nodesPayload },
            { timeout: 15000 },
          );
          logger.info(`[KGraph] Embed call success for imported nodes (userId: ${userId}, count: ${nodesPayload.length})`);
        } catch (err) {
          logger.error(`[KGraph] Embed call failed for importNodes (msgId: ${messageId}):`, err?.message || err);
        }
      });
    } catch (e) {
      logger.error(`[KGraph] Failed scheduling embed call for importNodes (msgId: ${messageId}):`, e?.message || e);
    }

    return addedNodesForFrontend;
  } catch (error) {
    logger.error(`[KGraph] Error in importNodes (userId: ${userId}, msgId: ${messageId})`, error);
    throw new Error(`노드 가져오기 실패: ${error.message}`);
  }
};

/**
 * [MERGED] (API 2.4) POST /nodes/delete
 * 여러 노드를 일괄 삭제합니다. (Kgraph.js의 아토믹 연산 및 임베딩 삭제 로직 사용)
 * @param {string} userId - 사용자 ID
 * @param {Array<string>} nodeIds - 삭제할 노드 ID 배열
 * @returns {Promise<object>} 삭제 결과
 */
const deleteNodes = async (userId, { nodeIds }) => {
  if (!Array.isArray(nodeIds) || nodeIds.length === 0) {
    throw new Error('삭제할 노드 ID 배열이 필요합니다.');
  }

  const ObjectId = mongoose.Types.ObjectId;
  let ownerId;
  try {
     ownerId = ObjectId(userId);
  } catch (e) {
    logger.error(`[KGraph] deleteNodes: Invalid userId format (userId: ${userId})`, e);
    throw new Error('유효하지 않은 사용자 ID입니다.');
  }


  const convertedIds = nodeIds.map((id) => {
    try {
      return ObjectId(id);
    } catch (e) {
      return String(id);
    }
  });

  try {
    // 1. 노드들을 제거 (Kgraph.js 방식)
    const updated = await KGraph.findOneAndUpdate(
      { userId: userId }, // 스키마에 따라 'user'가 아닌 'userId'로 조회
      { $pull: { nodes: { _id: { $in: convertedIds } } } },
      { new: true },
    ).exec();

    if (!updated) {
      logger.warn(`[KGraph] deleteNodes: User graph not found or no nodes deleted (userId: ${userId})`);
      // 노드가 없는 경우에도 엣지 삭제는 시도해야 할 수 있음
    }

    // 2. 이 노드들과 연결된 모든 엣지를 제거 (Kgraph.js 방식)
    try {
      const idStrings = convertedIds.map((i) => String(i));
      await KGraph.updateOne(
        { userId: userId },
        {
          $pull: { edges: { $or: [{ source: { $in: idStrings } }, { target: { $in: idStrings } }] } },
        },
      ).exec();
    } catch (e) {
      // 엣지 삭제는 best-effort; 로깅하되 실패시키지 않음
      logger.error('[KGraph] Failed removing edges referencing deleted nodes:', e?.message || e);
    }

    // 3. [MERGED] 임베딩 서비스에서 벡터 삭제 (Kgraph.js 로직)
    try {
      const idStrings = convertedIds.map((i) => String(i));
      setImmediate(async () => {
        try {
          const url = EMBED_URL.endsWith('/delete') ? EMBED_URL : `${EMBED_URL}/delete`;
          await axios.post(url, { user_id: userId, ids: idStrings }, { timeout: 15000 });
          logger.info(`[KGraph] Embed delete call success (userId: ${userId}, count: ${idStrings.length})`);
        } catch (err) {
            logger.error(`[KGraph] Embed delete call failed (userId: ${userId}):`, {
                status: err?.response?.status,
                data: err?.response?.data,
                message: err?.message,
            });
        }
      });
    } catch (e) {
      logger.error('[KGraph] Failed scheduling embed delete call:', e?.message || e);
    }
    
    return { deletedNodes: nodeIds.length };

  } catch (error) {
     logger.error(`[KGraph] Error in deleteNodes (userId: ${userId})`, error);
     throw new Error('노드 삭제에 실패했습니다.');
  }
};

/**
 * (API 3.1) POST /edges
 * 엣지를 생성합니다. (라벨은 배열)
 * @param {string} userId - 사용자 ID
 * @param {object} edgeData - { source, target, label }
 * @returns {Promise<object>} 생성/업데이트된 엣지 객체
 */
const createEdge = async (userId, { source, target, label }) => {
  try {
    const graph = await getOrCreateGraphDoc(userId);

    // 엣지는 source와 target 쌍으로 고유함
    let edge = graph.edges.find((e) => e.source === source && e.target === target);

    if (edge) {
      // 엣지가 이미 존재하면, 새 라벨을 (중복이 아닐 경우) 추가
      if (label && !edge.label.includes(label)) {
        edge.label.push(label);
      }
    } else {
      // 엣지가 없으면 새로 생성
      const newEdge = {
        source,
        target,
        label: label ? [label] : [], // kgraphSchema.js 스키마와 호환
      };
      graph.edges.push(newEdge);
      edge = graph.edges[graph.edges.length - 1];
    }

    await graph.save();
    return { ...edge.toObject(), id: edge._id.toString() };
  } catch (error) {
    logger.error(`[KGraph] Error in createEdge (userId: ${userId})`, error);
    throw new Error('엣지 생성에 실패했습니다.');
  }
};

/**
 * (API 3.2) PATCH /edges
 * 엣지의 라벨 배열 전체를 수정(교체)합니다.
 * @param {string} userId - 사용자 ID
 * @param {object} edgeData - { source, target, label } (label은 배열이어야 함)
 * @returns {Promise<object>} 수정된 엣지 객체
 */
const updateEdge = async (userId, { source, target, label }) => {
  try {
    const graph = await getOrCreateGraphDoc(userId);
    const edge = graph.edges.find((e) => e.source === source && e.target === target);

    if (!edge) {
      throw new Error('수정할 엣지를 찾을 수 없습니다.');
    }

    // API 명세에 따라, 라벨 배열을 '교체'합니다.
    if (Array.isArray(label)) {
      edge.label = label;
    } else if (typeof label === 'string') {
      edge.label = [label]; // 단일 문자열도 배열로 감싸서 저장
    } else {
      edge.label = []; // 기본값
    }

    await graph.save();
    return { ...edge.toObject(), id: edge._id.toString() };
  } catch (error) {
    logger.error(`[KGraph] Error in updateEdge (userId: ${userId})`, error);
    throw new Error('엣지 수정에 실패했습니다.');
  }
};

/**
 * (API 3.3) DELETE /edges
 * 엣지를 삭제합니다. (source, target 기준)
 * @param {string} userId - 사용자 ID
 * @param {object} edgeData - { source, target }
 * @returns {Promise<object>} 삭제 결과
 */
const deleteEdge = async (userId, { source, target }) => {
  try {
    const graph = await getOrCreateGraphDoc(userId);
    const edge = graph.edges.find((e) => e.source === source && e.target === target);

    if (!edge) {
      throw new Error('삭제할 엣지를 찾을 수 없습니다.');
    }

    graph.edges.pull({ _id: edge._id }); // Sub-document 배열에서 제거
    await graph.save();

    return { deletedCount: 1 };
  } catch (error) {
    logger.error(`[KGraph] Error in deleteEdge (userId: ${userId})`, error);
    throw new Error('엣지 삭제에 실패했습니다.');
  }
};

// 4.3 연결 추천 로직 (여기에 함수 구현)
const getRecommendations = async (userId, nodeId) => {
  // (로직 구현...)
  logger.info(`[KGraph] getRecommendations (userId:${userId})`);
  // TODO: Python 추천 서비스 (recommendation.py) 호출 로직 필요
  return []; // 임시 반환
};

// 4.4 UMAP 재계산 로직 (여기에 함수 구현)
const updateUmap = async (userId) => {
  // (로직 구현...)
  logger.info(`[KGraph] updateUmap (userId: ${userId})`);
  // TODO: Python UMAP 서비스 (umap.py) 호출 로직 필요
  return { updated: 0 }; // 임시 반환
};

// 외부에서 함수들을 사용할 수 있도록 export
module.exports = {
  KGraph,
  getGraph,
  createNode,
  updateNode,
  importNodes,
  deleteNodes,
  createEdge,
  updateEdge,
  deleteEdge,
  getRecommendations,
  updateUmap,
};