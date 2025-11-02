const mongoose = require('mongoose');
const kgraphSchema = require('~/models/schema/kgraph');

const KGraph = mongoose.model('KGraph', kgraphSchema);

const createKGraph = async (graph) => {
  // 벡터 임베딩 로직도 포함해야
  const newGraph = new KGraph(graph);
  return await newGraph.save();
};

const getKGraph = async (id) => {
  return await KGraph.findById(id);
};

// TODO: 전체 그래프 일괄 반환 로직 



const getKGraphs = async (filter) => {
  return await KGraph.find(filter);
};

const updateKGraph = async (id, updates) => {
  return await KGraph.findByIdAndUpdate(id, updates, { new: true });
};

const deleteKGraph = async (id) => {
  return await KGraph.findByIdAndDelete(id);
};

module.exports = {
  KGraph,
  createKGraph,
  getKGraph,
  getKGraphs,
  updateKGraph,
  deleteKGraph,
};