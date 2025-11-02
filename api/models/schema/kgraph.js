const mongoose = require('mongoose');

// "캔버스에 등록된 지식 노드. Python 저장소의 실제 벡터를 참조하며, UMAP 연산으로 변환된 x,y 노드 좌표 저장."
// Knowledge Node: A knowledge node registered on the canvas. It references the actual vector in the Python repository 
// and stores the x,y node coordinates transformed by the UMAP operation.
const knowledgeNodeSchema = new mongoose.Schema({
  id: {
    type: String,
    required: true,
  },
  label: {
    type: String,
    required: true,
  },
  x: {
    type: Number,
    required: true,
  },
  y: {
    type: Number,
    required: true,
  },
  // Refers to the actual vector in the Python repository
  vector_ref: {
    type: String,
  },
  // TODO: 타임스탬프 추가( 새 연결, 수정시마다 갱신하는걸로 )
}, { _id: false });

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
    //TODO: label이 여러개 있을 수 있으니, 배열로 만들기
    type: String, // Type of relationship
  },
}, { _id: false });

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
