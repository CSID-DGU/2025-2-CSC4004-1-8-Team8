const mongoose = require('mongoose');
const logger = require('~/config/winston');

const oldOnes = async (userId, { top_k = 10 }) => {
  const KGraph = mongoose.model('KGraph');
  const graph = await KGraph.findOne({ userId });

  if (!graph) {
    logger.info(`[KGraph] No graph found for user ${userId}`);
    return [];
  }

  // Sort nodes by _id (timestamp) or createdAt if available.
  // Assuming _id has timestamp or we added updatedAt.
  // Let's use _id for creation time approximation if updatedAt isn't reliable on all nodes yet.
  // Or better, filter nodes that have updatedAt, sort by it.

  // Since we are working with a subdocument array, we can't use DB sort easily without aggregation.
  // We'll sort in memory for now (assuming graph isn't huge).

  const sortedNodes = [...graph.nodes].sort((a, b) => {
    // Sort ascending (oldest first)
    const dateA = a.createdAt || a._id.getTimestamp();
    const dateB = b.createdAt || b._id.getTimestamp();
    return dateA - dateB;
  });

  return sortedNodes.slice(0, top_k).map((node) => node._id.toString());
};

module.exports = oldOnes;
