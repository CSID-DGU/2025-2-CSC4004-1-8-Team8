const express = require('express');
const AskController = require('~/server/controllers/AskController');
const { addTitle, initializeClient } = require('~/server/services/Endpoints/openAI');
const {
  handleAbort,
  setHeaders,
  validateModel,
  validateEndpoint,
  buildEndpointOption,
  moderateText,
} = require('~/server/middleware');
const { TOOL_INSTRUCTIONS } = require('./toolInstructions');
const { KGraph } = require('../../../models/kGraph');

const router = express.Router();
router.use(moderateText);
router.post('/abort', handleAbort());

router.post(
  '/',
  validateEndpoint,
  validateModel,
  buildEndpointOption,
  setHeaders,
  async (req, res, next) => {
    const { tools, nodeIds } = req.body;

    // 1. Node ID 처리
    if (Array.isArray(nodeIds) && nodeIds.length > 0) {
      try {
        const graph = await KGraph.findOne({ userId: req.user.id });
        if (graph) {
          const selectedNodes = graph.nodes.filter((node) => nodeIds.includes(node._id.toString()));

          if (selectedNodes.length > 0) {
            let contextString = '[참고 자료]\n';
            selectedNodes.forEach((node, index) => {
              const label = Array.isArray(node.label) ? node.label.join(', ') : node.label;
              contextString += `${index + 1}. 노드: ${label}\n   내용: ${node.content}\n`;
            });
            contextString += '\n';

            req.body.text = `${contextString}${req.body.text}`;
          }
        }
      } catch (error) {
        console.error('Error fetching nodes:', error);
        // 노드 조회 실패 시에도 계속 진행 (선택적 기능이므로)
      }
    }

    // 2. Tool 처리
    if (typeof tools === 'string' && tools.length > 0) {
      const instruction = TOOL_INSTRUCTIONS[tools];
      if (instruction) {
        if (!req.body.endpointOption) {
          req.body.endpointOption = {};
        }
        const { promptPrefix } = req.body.endpointOption;
        req.body.endpointOption.promptPrefix = promptPrefix
          ? `${promptPrefix}\n${instruction}`
          : instruction;

        // 사용자 메시지에 툴 태그 추가
        req.body.text = `[${tools}] ${req.body.text}`;
      }
    }

    await AskController(req, res, next, initializeClient, addTitle);
  },
);

module.exports = router;
