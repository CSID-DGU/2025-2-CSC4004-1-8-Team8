const mongoose = require('mongoose');
// [수정됨] kgraphSchema 객체를 직접 가져옵니다.
const { kgraphSchema } = require('./schema/kgraphSchema');
const { Message } = require('./Message'); // 2.3 API (가져오기)에 필요
const logger = require('~/config/winston');

// [추가됨] 스키마를 'KGraph'라는 이름의 모델로 등록합니다.
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

  // [수정됨] 이제 KGraph는 Mongoose 모델이므로 .findOne() 사용이 가능합니다.
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
    const nodes = graph.nodes.map(n => ({ ...n.toObject(), id: n._id.toString() }));
    const edges = graph.edges.map(e => ({ ...e.toObject(), id: e._id.toString() }));

    return { nodes, edges };
  } catch (error) {
    logger.error(`[KGraph] Error in getGraph (userId: ${userId})`, error);
    throw new Error('지식 그래프 조회에 실패했습니다.');
  }
};

/**
 * (API 2.1) POST /nodes
 * 단일 노드를 생성합니다.
 * @param {string} userId - 사용자 ID
 * @param {object} nodeData - { label, x, y }
 * @returns {Promise<object>} 생성된 노드 객체 (id 포함)
 */
const createNode = async (userId, { label, x, y }) => {
  try {
    const graph = await getOrCreateGraphDoc(userId);
    
    const newNode = {
      label: label || '새 노드',
      x: x || 0,
      y: y || 0,
    };

    graph.nodes.push(newNode); // 배열에 새 노드 추가
    await graph.save();

    const createdNode = graph.nodes[graph.nodes.length - 1];
    return { ...createdNode.toObject(), id: createdNode._id.toString() };
  } catch (error) {
    logger.error(`[KGraph] Error in createNode (userId: ${userId})`, error);
    throw new Error('노드 생성에 실패했습니다.');
  }
};

/**
 * (API 2.2) PATCH /nodes/{nodeId}
 * 단일 노드의 정보를 (부분) 수정합니다.
 * @param {string} userId - 사용자 ID
 * @param {string} nodeId - 수정할 노드의 _id
 * @param {object} updateData - { label, x, y } (모두 선택적)
 * @returns {Promise<object>} 수정된 노드 객체
 */
const updateNode = async (userId, nodeId, { label, x, y }) => {
  try {
    const graph = await getOrCreateGraphDoc(userId);
    const node = graph.nodes.id(nodeId); // Sub-document ID로 찾기

    if (!node) {
      throw new Error('수정할 노드를 찾을 수 없습니다.');
    }

    // 제공된 필드만 업데이트
    if (label !== undefined) {
      node.label = label;
    }
    if (x !== undefined) {
      node.x = x;
    }
    if (y !== undefined) {
      node.y = y;
    }

    await graph.save();
    return { ...node.toObject(), id: node._id.toString() };
  } catch (error) {
    logger.error(`[KGraph] Error in updateNode (userId: ${userId}, nodeId: ${nodeId})`, error);
    throw new Error('노드 수정에 실패했습니다.');
  }
};

/**
 * (API 2.3) POST /nodes/batch
 * 특정 메시지의 임시 노드들을 지식 그래프로 일괄 가져오기.
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
    if (!message.tempNodes || message.tempNodes.length === 0) {
      throw new Error('가져올 임시 노드가 없습니다.');
    }

    const graph = await getOrCreateGraphDoc(userId);

    // tempNodes 구조가 nodeSchema와 호환된다고 가정 (필요시 변환)
    const newNodes = message.tempNodes.map(tn => ({
      label: tn.label || '새 노드',
      x: tn.x || 0,
      y: tn.y || 0,
    }));

    graph.nodes.push(...newNodes);
    message.isImported = true; // 가져오기 완료 플래그 설정

    // 두 문서(그래프, 메시지)를 동시에 저장
    await Promise.all([
      graph.save(),
      message.save()
    ]);

    // 방금 추가된 노드들을 반환 (ID 포함)
    const addedNodes = graph.nodes.slice(-newNodes.length);
    return addedNodes.map(n => ({ ...n.toObject(), id: n._id.toString() }));

  } catch (error) {
    logger.error(`[KGraph] Error in importNodes (userId: ${userId}, msgId: ${messageId})`, error);
    throw new Error(`노드 가져오기 실패: ${error.message}`);
  }
};

/**
 * (API 2.4) POST /nodes/delete
 * 여러 노드를 일괄 삭제합니다.
 * @param {string} userId - 사용자 ID
 * @param {Array<string>} nodeIds - 삭제할 노드 ID 배열
 * @returns {Promise<object>} 삭제 결과
 */
const deleteNodes = async (userId, { nodeIds }) => {
  if (!Array.isArray(nodeIds) || nodeIds.length === 0) {
    throw new Error('삭제할 노드 ID 배열이 필요합니다.');
  }

  try {
    const graph = await getOrCreateGraphDoc(userId);

    // 1. 이 노드들과 연결된 모든 엣지를 제거
    graph.edges.pull({
      $or: [
        { source: { $in: nodeIds } },
        { target: { $in: nodeIds } }
      ]
    });

    // 2. 노드들을 제거
   nodeIds.forEach(nodeId => {
      graph.nodes.pull(nodeId);
    })

    await graph.save();
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
    let edge = graph.edges.find(e => e.source === source && e.target === target);

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
        label: label ? [label] : [], // 스키마에 따라 배열로 저장
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
    const edge = graph.edges.find(e => e.source === source && e.target === target);

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
    const edge = graph.edges.find(e => e.source === source && e.target === target);

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


// 외부에서 함수들을 사용할 수 있도록 export
module.exports = {
  getGraph,
  createNode,
  updateNode,
  importNodes,
  deleteNodes,
  createEdge,
  updateEdge,
  deleteEdge,
};