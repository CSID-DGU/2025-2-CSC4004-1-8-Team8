const throttle = require('lodash/throttle');
const { getResponseSender, Constants, CacheKeys, Time } = require('librechat-data-provider');
const { createAbortController, handleAbortError } = require('~/server/middleware');
const { sendMessage, createOnProgress } = require('~/server/utils');
const { getLogStores } = require('~/cache');
const { saveMessage } = require('~/models');
const { logger } = require('~/config');

const AskController = async (req, res, next, initializeClient, addTitle) => {
  let {
    text,
    endpointOption,
    conversationId,
    modelDisplayLabel,
    parentMessageId = null,
    overrideParentMessageId = null,
  } = req.body;

  logger.debug('[AskController]', {
    text,
    conversationId,
    ...endpointOption,
    modelsConfig: endpointOption.modelsConfig ? 'exists' : '',
  });

  let userMessage;
  let userMessagePromise;
  let promptTokens;
  let userMessageId;
  let responseMessageId;
  const sender = getResponseSender({
    ...endpointOption,
    model: endpointOption.modelOptions.model,
    modelDisplayLabel,
  });
  const newConvo = !conversationId;
  const user = req.user.id;

  const getReqData = (data = {}) => {
    for (let key in data) {
      if (key === 'userMessage') {
        userMessage = data[key];
        userMessageId = data[key].messageId;
      } else if (key === 'userMessagePromise') {
        userMessagePromise = data[key];
      } else if (key === 'responseMessageId') {
        responseMessageId = data[key];
      } else if (key === 'promptTokens') {
        promptTokens = data[key];
      } else if (!conversationId && key === 'conversationId') {
        conversationId = data[key];
      }
    }
  };

  let getText;

  try {
    const { client } = await initializeClient({ req, res, endpointOption });
    const messageCache = getLogStores(CacheKeys.MESSAGES);
    const { onProgress: progressCallback, getPartialText } = createOnProgress({
      onProgress: throttle(
        ({ text: partialText }) => {
          /*
              const unfinished = endpointOption.endpoint === EModelEndpoint.google ? false : true;
          messageCache.set(responseMessageId, {
            messageId: responseMessageId,
            sender,
            conversationId,
            parentMessageId: overrideParentMessageId ?? userMessageId,
            text: partialText,
            model: client.modelOptions.model,
            unfinished,
            error: false,
            user,
          }, Time.FIVE_MINUTES);
          */

          messageCache.set(responseMessageId, partialText, Time.FIVE_MINUTES);
        },
        3000,
        { trailing: false },
      ),
    });

    getText = getPartialText;

    const getAbortData = () => ({
      sender,
      conversationId,
      userMessagePromise,
      messageId: responseMessageId,
      parentMessageId: overrideParentMessageId ?? userMessageId,
      text: getPartialText(),
      userMessage,
      promptTokens,
    });

    const { abortController, onStart } = createAbortController(req, res, getAbortData, getReqData);

    res.on('close', () => {
      logger.debug('[AskController] Request closed');
      if (!abortController) {
        return;
      } else if (abortController.signal.aborted) {
        return;
      } else if (abortController.requestCompleted) {
        return;
      }

      abortController.abort();
      logger.debug('[AskController] Request aborted on close');
    });

    const messageOptions = {
      user,
      parentMessageId,
      conversationId,
      overrideParentMessageId,
      getReqData,
      onStart,
      abortController,
      progressCallback,
      progressOptions: {
        res,
        // parentMessageId: overrideParentMessageId || userMessageId,
      },
    };

    let response = await client.sendMessage(text, messageOptions);
    response.endpoint = endpointOption.endpoint;

    // Normalize response shape and extract atomic_ideas if present or encoded in JSON string
    let atomicIdeas = Array.isArray(response?.atomic_ideas) ? response.atomic_ideas : null;

    // Helper to try parsing a JSON string for response/atomic_ideas fields
    const tryParseIdeas = (raw) => {
      if (typeof raw !== 'string') return null;
      try {
        const parsed = JSON.parse(raw);
        if (parsed?.atomic_ideas && Array.isArray(parsed.atomic_ideas)) {
          if (parsed?.response && !response.text) {
            response = { ...response, text: parsed.response };
          }
          return parsed.atomic_ideas;
        }
        return null;
      } catch {
        return null;
      }
    };

    if (!atomicIdeas) {
      atomicIdeas = tryParseIdeas(response?.text) || tryParseIdeas(response);
    }

    if (!response.text && typeof response === 'string') {
      response = { ...response, text: response };
    }

    // Fallback: derive atomic ideas from plain text (simple bullet/numbered list extraction)
    const extractIdeasFromText = (raw) => {
      if (!raw || typeof raw !== 'string') return [];
      const lines = raw.split(/\r?\n/);
      const out = [];
      const bulletRe = /^(?:\s*)(?:\d+[\.)]|[-*•])\s+(.*)$/;
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const m = trimmed.match(bulletRe);
        const content = m?.[1] || trimmed;
        if (content && content.length > 0) {
          out.push({ content, isCurated: false });
        }
        if (out.length >= 10) break;
      }
      return out;
    };

    const { conversation = {} } = await client.responsePromise;
    conversation.title =
      conversation && !conversation.title ? null : conversation?.title || 'New Chat';

    if (client.options.attachments) {
      userMessage.files = client.options.attachments;
      conversation.model = endpointOption.modelOptions.model;
      delete userMessage.image_urls;
    }

    if (!abortController.signal.aborted) {
      // Save to DB and get the saved message with nodes (including _id)
      const savedMessage = await saveMessage(
        req,
        { ...response, atomic_ideas: atomicIdeas ?? response?.atomic_ideas, user },
        { context: 'api/server/controllers/AskController.js - response end' },
      );

      const resolvedNodes =
        (savedMessage?.nodes && Array.isArray(savedMessage.nodes) && savedMessage.nodes.length
          ? savedMessage.nodes
          : null) ||
        (response?.nodes && Array.isArray(response.nodes) && response.nodes.length
          ? response.nodes
          : null) ||
        (atomicIdeas && Array.isArray(atomicIdeas) && atomicIdeas.length
          ? atomicIdeas.map((idea) =>
              typeof idea === 'object' && idea !== null && 'content' in idea
                ? { ...idea, content: idea.content, isCurated: false }
                : { content: String(idea), isCurated: false },
            )
          : null) ||
        extractIdeasFromText(response?.text) ||
        [];

      // Send final response with messageId and nodes from saved message
      sendMessage(res, {
        final: true,
        conversation,
        title: conversation.title,
        requestMessage: userMessage,
        responseMessage: {
          ...response,
          messageId: savedMessage?.messageId || responseMessageId,
          nodes: resolvedNodes,
        },
      });

      res.end();
    }

    if (!client.skipSaveUserMessage) {
      await saveMessage(req, userMessage, {
        context: 'api/server/controllers/AskController.js - don\'t skip saving user message',
      });
    }

    if (addTitle && parentMessageId === Constants.NO_PARENT && newConvo) {
      addTitle(req, {
        text,
        response,
        client,
      });
    }
  } catch (error) {
    const partialText = getText && getText();
    handleAbortError(res, req, error, {
      partialText,
      conversationId,
      sender,
      messageId: responseMessageId,
      parentMessageId: userMessageId ?? parentMessageId,
    });
  }
};

module.exports = AskController;
