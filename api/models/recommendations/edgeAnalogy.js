const axios = require('axios');
const logger = require('~/config/winston');

const PYTHON_RECOMMENDATION_URL = process.env.PYTHON_SERVER_URL
  ? `${process.env.PYTHON_SERVER_URL}/recommendation`
  : 'http://localhost:8000/recommendation';

const edgeAnalogy = async (userId, { nodeId, edge_label, top_k = 10 }) => {
  if (!nodeId || !edge_label) {
    throw new Error('nodeId and edge_label are required for edge_analogy recommendation');
  }

  logger.info(
    `[KGraph] edge_analogy called (userId: ${userId}, nodeId: ${nodeId}, label: ${edge_label})`,
  );

  const response = await axios.post(
    `${PYTHON_RECOMMENDATION_URL}?method=edge_analogy&top_k=${top_k}`,
    {
      user_id: userId,
      node_id: nodeId,
      edge_label: edge_label,
    },
    { timeout: 15000 },
  );

  return (response.data.recommendations || []).map((r) => r.id);
};

module.exports = edgeAnalogy;
