const mongoose = require('mongoose');

// "캔버스에 등록된 지식 노드. Python 저장소의 실제 벡터를 참조하며, UMAP 연산으로 변환된 x,y 노드 좌표 저장."
// Knowledge Node: A knowledge node registered on the canvas. It references the actual vector in the Python repository 
// and stores the x,y node coordinates transformed by the UMAP operation.
const knowledgeNodeSchema = new mongoose.Schema({
  content: {
    type: String,
    required: true,
  },
  label: {
    type: [String],
    required: false,
    default: [],
  },
  x: {
    type: Number,
    required: false,
    default: null,
  },
  y: {
    type: Number,
    required: false,
    default: null,
  },
  // vector_ref removed: we now use the node subdocument `_id` (Mongo ObjectId) as the Chroma id
  // Timestamps for node lifecycle (set on creation/update by application logic)
  createdAt: {
    type: Date,
    required: false,
  },
  updatedAt: {
    type: Date,
    required: false,
  },
});

// "노드 간의 관계. 엣지 벡터(Target -> Source) 및 관계의 유형을 저장."
// Knowledge Edge: Relationship between nodes. Stores the edge vector (Target -> Source) and the type of relationship.
const knowledgeEdgeSchema = new mongoose.Schema({
  source: {
    type: String,
    required: true,
  },
  target: {
    type: String,
    required: true,
  },
  label: {
    type: [String], // Type(s) of relationship
    required: false,
    default: [],
  },
  // Timestamps for edge lifecycle
  createdAt: {
    type: Date,
    required: false,
  },
  updatedAt: {
    type: Date,
    required: false,
  },
});

const kgraphSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true,
  },

  nodes: [knowledgeNodeSchema],
  edges: [knowledgeEdgeSchema],
}, { timestamps: true });

module.exports = kgraphSchema;
