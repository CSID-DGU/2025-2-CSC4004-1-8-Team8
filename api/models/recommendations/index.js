const leastSimilar = require('./leastSimilar');
const synonyms = require('./synonyms');
const nodeTag = require('./nodeTag');
const edgeAnalogy = require('./edgeAnalogy');
const oldOnes = require('./oldOnes');

const strategies = {
  least_similar: leastSimilar,
  synonyms: synonyms,
  node_tag: nodeTag,
  edge_analogy: edgeAnalogy,
  old_ones: oldOnes,
};

module.exports = strategies;
