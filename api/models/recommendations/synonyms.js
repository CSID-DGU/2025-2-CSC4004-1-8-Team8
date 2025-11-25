const axios = require('axios');
const logger = require('~/config/winston');

const PYTHON_RECOMMENDATION_URL = process.env.PYTHON_SERVER_URL
  ? `${process.env.PYTHON_SERVER_URL}/recommendation`
  : 'http://localhost:8000/recommendation';

const synonyms = async (userId, { nodeId, top_k = 10 }) => {
  if (!nodeId) {
    throw new Error('nodeId is required for synonyms recommendation');
  }

  const response = await axios.post(
    `${PYTHON_RECOMMENDATION_URL}?method=synonyms&top_k=${top_k}`,
    { user_id: userId, node_id: nodeId },
    { timeout: 15000 },
  );

  return (response.data.recommendations || []).map((r) => r.id);
};

module.exports = synonyms;
