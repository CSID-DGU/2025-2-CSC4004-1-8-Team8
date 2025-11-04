const mongoose = require('mongoose');
const { Schema } = mongoose;

const nodeSchema = new Schema(
  {
    // label: Text content displayed on the node
    label: {
      type: String,
      required: true,
      default: '새 노드',
    },
    // x, y: Positional coordinates for visualization
    x: {
      type: Number,
      default: 0,
    },
    y: {
      type: Number,
      default: 0,
    },
    // Note: API spec 'id' will be served by MongoDB's default '_id'.
    // Note: API spec 'updatedAt' is handled by 'timestamps: true'.
  },
  {
    timestamps: true, // Automatically adds createdAt and updatedAt fields
    _id: true, // Ensures MongoDB automatically generates a unique _id
  },
);

/**
 * Edge Sub-document Schema
 * API Spec 1.1 (edges)
 * Defines the structure for connections (edges) between nodes.
 */
const edgeSchema = new Schema(
  {
    // source: The _id of the starting node
    source: {
      type: String,
      required: true,
    },
    // target: The _id of the ending node
    target: {
      type: String,
      required: true,
    },
    // label: Description of the relationship.
    // Defined as an array to support multiple labels between two nodes, per meeting.
    label: {
      type: [String],
      default: [],
    },
    // Note: API spec 'id' will be served by MongoDB's default '_id'.
  },
  {
    timestamps: true, // Automatically adds createdAt and updatedAt fields
    _id: true,
  },
);

/**
 * KGraph (Knowledge Graph) Main Schema
 * This is the parent document that holds all nodes and edges for a specific user.
 */
const kgraphSchema = new Schema(
  {
    // Matches the 'userId' field in userSchema.js
    userId: {
      type: String,
      required: true,
      unique: true, // Each user must have only one knowledge graph
      index: true, // Improves query performance when finding a user's graph
    },
    // Embeds the nodes array using the nodeSchema
    nodes: [nodeSchema],
    // Embeds the edges array using the edgeSchema
    edges: [edgeSchema],
  },
  {
    timestamps: true, // For tracking when the graph itself was created/updated
  },
);

// Export the schemas for use in Models
// nodeSchema is exported separately for reuse in messageSchema.js
module.exports = {
  kgraphSchema,
  nodeSchema,
  edgeSchema,
};