const express = require('express');
const router = express.Router();
const { requireJwtAuth } = require('../middleware'); // 사용자 인증용 미들웨어
const KGraph = require('../../models/KGraph'); // 1단계에서 만든 기능 모음 파일
const logger = require('~/config/winston'); // 로그 기록용

/**
 * (API 4.1) GET /api/kgraphs/graph
 * 사용자의 전체 지식 그래프 조회
 */
router.get('/graph', requireJwtAuth, async (req, res) => {
  try {
    const graphData = await KGraph.getGraph(req.user.id);
    res.status(200).json(graphData);
  } catch (error) {
    logger.error(`[kgraph.js] /graph GET Error: ${error.message}`);
    res.status(500).json({ message: '그래프 조회에 실패했습니다.' });
  }
});

/**
 * (API 2.1) POST /api/kgraphs/nodes
 * 단일 노드 생성
 */
router.post('/nodes', requireJwtAuth, async (req, res) => {
  try {
    const node = await KGraph.createNode(req.user.id, req.body);
    // API 명세에는 없지만, 생성된 노드 정보를 반환하면 프론트에서 유용합니다.
    res.status(201).json(node); 
  } catch (error) {
    logger.error(`[kgraph.js] /nodes POST Error: ${error.message}`);
    res.status(500).json({ message: '노드 생성에 실패했습니다.' });
  }
});

/**
 * (API 2.2) PATCH /api/kgraphs/nodes/:nodeId
 * 단일 노드 정보 수정 (라벨, 좌표 등)
 */
router.patch('/nodes/:nodeId', requireJwtAuth, async (req, res) => {
  try {
    const { nodeId } = req.params;
    const updatedNode = await KGraph.updateNode(req.user.id, nodeId, req.body);
    res.status(200).json(updatedNode);
  } catch (error) {
    logger.error(`[kgraph.js] /nodes/:nodeId PATCH Error: ${error.message}`);
    res.status(404).json({ message: error.message }); // 404: 노드를 찾을 수 없음
  }
});

/**
 * (API 2.3) POST /api/kgraphs/nodes/batch
 * 임시 노드 일괄 가져오기 (회의록 기반)
 */
router.post('/nodes/batch', requireJwtAuth, async (req, res) => {
  try {
    // req.body에 { messageId: "..." }가 포함되어 있어야 함
    const newNodes = await KGraph.importNodes(req.user.id, req.body);
    res.status(201).json(newNodes); // 생성된 노드들 반환
  } catch (error) {
    logger.error(`[kgraph.js] /nodes/batch POST Error: ${error.message}`);
    res.status(400).json({ message: error.message }); // 400: 잘못된 요청 (e.g., 이미 임포트됨)
  }
});

/**
 * (API 2.4) POST /api/kgraphs/nodes/delete
 * 노드 일괄 삭제
 */
router.post('/nodes/delete', requireJwtAuth, async (req, res) => {
  try {
    // req.body에 { nodeIds: [...] }가 포함되어 있어야 함
    await KGraph.deleteNodes(req.user.id, req.body);
    res.sendStatus(204); // 성공 (내용 없음)
  } catch (error) {
    logger.error(`[kgraph.js] /nodes/delete POST Error: ${error.message}`);
    res.status(400).json({ message: error.message });
  }
});

/**
 * (API 3.1) POST /api/kgraphs/edges
 * 엣지 생성 (또는 기존 엣지에 라벨 추가)
 */
router.post('/edges', requireJwtAuth, async (req, res) => {
  try {
    // req.body에 { source, target, label }이 포함되어 있어야 함
    const edge = await KGraph.createEdge(req.user.id, req.body);
    res.status(201).json(edge);
  } catch (error) {
    logger.error(`[kgraph.js] /edges POST Error: ${error.message}`);
    res.status(500).json({ message: '엣지 생성에 실패했습니다.' });
  }
});

/**
 * (API 3.2) PATCH /api/kgraphs/edges
 * 엣지 라벨 수정 (배열 전체 교체)
 */
router.patch('/edges', requireJwtAuth, async (req, res) => {
  try {
    // req.body에 { source, target, label: [...] }이 포함되어 있어야 함
    const updatedEdge = await KGraph.updateEdge(req.user.id, req.body);
    res.status(200).json(updatedEdge);
  } catch (error) {
    logger.error(`[kgraph.js] /edges PATCH Error: ${error.message}`);
    res.status(404).json({ message: error.message }); // 404: 엣지를 찾을 수 없음
  }
});

/**
 * (API 3.3) DELETE /api/kgraphs/edges
 * 엣지 삭제 (source, target 기준)
 */
router.delete('/edges', requireJwtAuth, async (req, res) => {
  try {
    // req.body에 { source, target }이 포함되어 있어야 함
    await KGraph.deleteEdge(req.user.id, req.body);
    res.sendStatus(204); // 성공 (내용 없음)
  } catch (error) {
    logger.error(`[kgraph.js] /edges DELETE Error: ${error.message}`);
    res.status(404).json({ message: error.message }); // 404: 엣지를 찾을 수 없음
  }
});

// --- API 4.2 & 4.3 (Python 연동 기능) ---
// 지금은 Chan Park 님이 작업하실 Python 로직을 호출하는 대신
// "아직 구현되지 않음" (501 Not Implemented)을 반환하는 코드를 넣어둡니다.

/**
 * (API 4.2) POST /api/kgraphs/graph/cluster
 * UMAP 재계산 요청 (Python 작업)
 */
router.post('/graph/cluster', requireJwtAuth, async (req, res) => {
  logger.info(`[kgraph.js] /graph/cluster POST 호출됨 (구현 예정)`);
  // TODO: Chan Park 님의 Python MQ 로직 호출
  res.status(501).json({ message: 'UMAP 클러스터링 기능은 아직 구현 중입니다.' });
});

/**
 * (API 4.3) GET /api/kgraphs/graph/recommendations
 * 연결 추천 요청 (Python 작업)
 */
router.get('/graph/recommendations', requireJwtAuth, async (req, res) => {
  logger.info(`[kgraph.js] /graph/recommendations GET 호출됨 (구현 예정)`);
  // TODO: Chan Park 님의 Python MQ 로직 호출
  res.status(501).json({ message: '연결 추천 기능은 아직 구현 중입니다.' });
});


module.exports = router;