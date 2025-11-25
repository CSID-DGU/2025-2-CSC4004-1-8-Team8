const mongoose = require('mongoose');
const logger = require('~/config/winston');
// Circular dependency avoidance: pass model or require inside function if needed,
// but here we can require the model if it's already registered.
// Better to pass the model or use mongoose.model('KGraph')

const nodeTag = async (userId, { tag }) => {
  if (!tag) {
    throw new Error('tag is required for node_tag recommendation');
  }

  const KGraph = mongoose.model('KGraph');
  const graph = await KGraph.findOne({ userId });

  if (!graph) {
    logger.info(`[KGraph] No graph found for user ${userId}`);
    return [];
  }

  // Find nodes that contain the tag in their label array
  const nodes = graph.nodes.filter((node) => node.label && node.label.includes(tag));

  // Return formatted recommendations
  return nodes.map((node) => node._id.toString());
};

module.exports = nodeTag;
