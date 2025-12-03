import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRecoilState, useRecoilValue } from 'recoil';
import { request } from 'librechat-data-provider';
import type { TMessage } from 'librechat-data-provider';

import { Button } from '~/components';
import { useLocalize } from '~/hooks';
import store from '~/store';
import type { CandidateNode } from '~/store/knowledgeGraph';
import { createGraphNode } from '~/api/kgraph';

const MAX_CANDIDATES = 8;
const MIN_SUMMARY_LENGTH = 400;

type ExtractedCandidate = {
  content: string;
  label: string;
};

const toLine = (s: string) =>
  s
    .trim()
    .replace(/[\t\s]+/g, ' ')
    .replace(/^[-*]\s*/, '')
    .replace(/^[0-9]+[\.)]\s*/, '')
    .replace(/^#{1,6}\s*/, '')
    .replace(/[\s:]+$/, '');

const toLabel = (s: string) => {
  let t = toLine(s).split(' - ')[0].split(' ??')[0].split(':')[0].split('|')[0];
  t = t.split(/[.!?]/)[0].trim();
  t = t.replace(/^\*+\s*/, '').trim();
  if (t.length > 40) {
    t = `${t.slice(0, 37)}...`;
  }
  return t;
};

const buildExtracted = (raw: string): ExtractedCandidate | null => {
  const content = toLine(raw);
  if (!content) {
    return null;
  }
  const label = toLabel(content) || content.slice(0, 40);
  if (!label) {
    return null;
  }
  return { content, label };
};

const extractFromText = (text: string) => {
  if (!text) {
    return [] as ExtractedCandidate[];
  }
  const bulletRe = /^(?:\s*)(?:\d+[\.)]|[-*])\s+(.*)$/;
  const headingRe = /^(?:\s*)(?:#{1,6}\s*)(.+)$/;
  const out: ExtractedCandidate[] = [];
  const seen = new Set<string>();

  const addCandidate = (raw: string) => {
    const candidate = buildExtracted(raw);
    if (!candidate) {
      return;
    }
    const key = candidate.content.toLowerCase();
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    out.push(candidate);
  };

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      continue;
    }
    let m = line.match(bulletRe);
    if (m?.[1]) {
      addCandidate(m[1]);
      continue;
    }
    m = line.match(headingRe);
    if (m?.[1]) {
      addCandidate(m[1]);
      continue;
    }
    if (/:$/.test(line)) {
      addCandidate(line);
    }
  }

  if (out.length === 0) {
    const sentences = text.split(/(?<=[.!?])\s+/);
    sentences.forEach((sentence) => addCandidate(sentence));
  }

  return out.slice(0, MAX_CANDIDATES);
};

const extractRawText = (message: TMessage | null) => {
  if (!message) return '';
  if (typeof (message as any).text === 'string' && (message as any).text.trim()) {
    return (message as any).text as string;
  }
  if (Array.isArray((message as any).content)) {
    return (message as any).content
      .map((part: any) =>
        part?.type === 'text' ? part.text : typeof part === 'string' ? part : '',
      )
      .filter(Boolean)
      .join('\n');
  }
  return '';
};

const parseLLMJson = (text: string): ExtractedCandidate[] => {
  try {
    const json = JSON.parse(text);
    if (!Array.isArray(json)) return [];
    return json
      .map((item) => {
        if (typeof item === 'string') {
          return buildExtracted(item);
        }
        const raw = `${item?.content ?? ''}` || `${item?.label ?? ''}`;
        return buildExtracted(raw);
      })
      .filter((c): c is ExtractedCandidate => !!c);
  } catch {
    return [];
  }
};

const normalizeAndFilter = (list: ExtractedCandidate[]): ExtractedCandidate[] => {
  const out: ExtractedCandidate[] = [];
  const seen = new Set<string>();

  for (const c of list) {
    const content = c.content.trim();
    const label = c.label.trim();
    if (!content || !label) continue;
    if (content.length < 30) continue; // too short ??skip
    if (label.length < 3) continue;
    if (content.toLowerCase() === label.toLowerCase()) continue;

    const key = `${label.toLowerCase()}|${content.slice(0, 60).toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ content, label: label.length > 40 ? `${label.slice(0, 37)}...` : label });

    if (out.length >= MAX_CANDIDATES) break;
  }

  return out;
};

const extractFromDOM = () => {
  const selector = [
    '.markdown.prose.message-content ol li',
    '.markdown.prose.message-content ul li',
    '.markdown.prose.message-content h1',
    '.markdown.prose.message-content h2',
    '.markdown.prose.message-content h3',
    '.markdown.prose.message-content h4',
    '.markdown.prose.message-content h5',
    '.markdown.prose.message-content h6',
  ].join(',');
  const nodes = Array.from(document.querySelectorAll(selector));
  return nodes
    .slice(-30)
    .map((el) => el.textContent || '')
    .map((line) => buildExtracted(line))
    .filter((candidate): candidate is ExtractedCandidate => !!candidate)
    .slice(0, MAX_CANDIDATES);
};

const buildCandidateNode = (
  convoId: string,
  candidate: ExtractedCandidate,
  opts?: { message?: TMessage; isSeed?: boolean },
): CandidateNode => ({
  id: `${opts?.message?.messageId ?? 'dom'}-${crypto.randomUUID?.() ?? Date.now()}`,
  label: candidate.label,
  content: candidate.content,
  source_message_id: opts?.message?.messageId,
  source_conversation_id: convoId,
  isSeed: opts?.isSeed,
});

const resolveConvoId = (conversation: any, messages: TMessage[] | null | undefined) => {
  if (conversation?.conversationId) return conversation.conversationId as string;
  if (Array.isArray(messages)) {
    const withId = messages.find((m) => (m as any)?.conversationId);
    if (withId?.conversationId) return withId.conversationId as string;
  }
  if (typeof window !== 'undefined') {
    const parts = window.location.pathname.split('/').filter(Boolean);
    const idx = parts.indexOf('c');
    if (idx >= 0 && parts[idx + 1]) return parts[idx + 1];
  }
  return 'default';
};

export default function CandidatesPanel() {
  const localize = useLocalize();
  const conversation = useRecoilValue(store.conversation);
  const messages = useRecoilValue(store.messages);
  const latestMessage = useRecoilValue(store.latestMessage);
  const convoId = resolveConvoId(conversation, messages);
  const [candidates, setCandidates] = useRecoilState(store.candidateNodesByConvo(convoId));
  const [, setGraphNodes] = useRecoilState(store.knowledgeNodesByConvo(convoId));
  const lastHandledMessage = useRef<string | null>(null);
  const summarizedMessages = useRef<Set<string>>(new Set());
  const seenContents = useRef<Set<string>>(new Set());
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draftNew, setDraftNew] = useState<{ label: string; content: string }>({
    label: '',
    content: '',
  });

  const lastAssistant = useMemo(() => {
    const arr = Array.isArray(messages) ? messages : [];
    for (let i = arr.length - 1; i >= 0; i--) {
      const m = arr[i];
      if (m && !m.isCreatedByUser) {
        return m as TMessage;
      }
    }
    return latestMessage && !(latestMessage as any).isCreatedByUser
      ? (latestMessage as TMessage)
      : null;
  }, [messages, latestMessage?.messageId]);

  // reset per conversation to avoid leakage
  useEffect(() => {
    lastHandledMessage.current = null;
    summarizedMessages.current.clear();
    seenContents.current.clear();
    setCandidates([]);
  }, [convoId, setCandidates]);

  const mergeCandidates = useCallback(
    (extracted: ExtractedCandidate[], message?: TMessage) => {
      const cleaned = normalizeAndFilter(extracted);
      if (!cleaned.length) return;
      setCandidates((prev) => {
        const existing = new Set(seenContents.current);
        const additions = cleaned
          .map((candidate) => buildCandidateNode(convoId, candidate, { message }))
          .filter((candidate) => {
            const key = candidate.content.toLowerCase();
            if (existing.has(key)) return false;
            existing.add(key);
            return true;
          });
        if (additions.length) {
          // persist seen so removed items do not come back in this convo
          additions.forEach((c) => seenContents.current.add(c.content.toLowerCase()));
          return [...prev, ...additions];
        }
        return prev;
      });
    },
    [convoId, setCandidates],
  );

  const fetchLLMSummary = useCallback(async (text: string): Promise<ExtractedCandidate[]> => {
    if (!text || text.length < MIN_SUMMARY_LENGTH) {
      return [];
    }
    const payload = {
      text,
      endpoint: 'openAI', // adjust based on available endpoint
      model: 'gpt-4o-mini', // adjust to your deployed model
      messages: [{ role: 'user', content: text.slice(0, 4000) }],
      temperature: 0.2,
      stream: false,
    };

    try {
      const res: any = await request.post('/api/ask/openAI', payload);
      const llmText = (res?.text as string) ?? (res?.message as string) ?? '';
      return parseLLMJson(llmText);
    } catch (err) {
      console.warn('LLM summarize failed', err);
      return [];
    }
  }, []);

  useEffect(() => {
    const message = lastAssistant;
    if (!message?.messageId) return;
    if (lastHandledMessage.current === message.messageId) return;
    const rawText = extractRawText(message);

    const run = async () => {
      let extracted: ExtractedCandidate[] = [];

      if (
        !summarizedMessages.current.has(message.messageId) &&
        rawText.length >= MIN_SUMMARY_LENGTH
      ) {
        const llm = await fetchLLMSummary(rawText);
        const cleaned = normalizeAndFilter(llm);
        if (cleaned.length) {
          summarizedMessages.current.add(message.messageId);
          extracted = cleaned;
        }
      }

      if (!extracted.length) {
        extracted = extractFromText(rawText);
      }

      mergeCandidates(extracted, message);
      lastHandledMessage.current = message.messageId;
    };

    run();
  }, [lastAssistant, mergeCandidates, fetchLLMSummary]);

  useEffect(() => {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.addedNodes?.length) {
          const extracted = extractFromDOM();
          if (extracted.length) {
            mergeCandidates(extracted);
          }
          break;
        }
      }
    });

    try {
      observer.observe(document.body, { childList: true, subtree: true });
    } catch (_) {
      // ignore
    }

    return () => observer.disconnect();
  }, [mergeCandidates, convoId]);

  const persistGraphNode = useCallback(
    async (candidate: CandidateNode) => {
      const newNode = await createGraphNode({
        label: candidate.label,
        labels: [candidate.label],
        content: candidate.content,
        idea_text: candidate.content,
        x: null,
        y: null,
        source_message_id: candidate.source_message_id,
        source_conversation_id: candidate.source_conversation_id,
      });
      const patchedNode = {
        ...newNode,
        source_conversation_id:
          newNode.source_conversation_id || candidate.source_conversation_id || convoId,
        labels:
          Array.isArray((newNode as any).labels) && (newNode as any).labels.length
            ? (newNode as any).labels
            : [candidate.label],
        content: newNode.content || candidate.content,
      };
      setGraphNodes((prev) => [...prev, patchedNode]);
      setCandidates((prev) => prev.filter((item) => item.id !== candidate.id));
    },
    [convoId, setCandidates, setGraphNodes],
  );

  const handleMove = async (candidate: CandidateNode) => {
    setPendingId(candidate.id);
    setError(null);
    try {
      await persistGraphNode(candidate);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add node');
    } finally {
      setPendingId(null);
    }
  };

  const handleDeleteCandidate = (candidate: CandidateNode) => {
    setCandidates((prev) => prev.filter((c) => c.id !== candidate.id));
    seenContents.current.delete(candidate.content.toLowerCase());
  };

  const handleUpdateCandidate = (id: string, field: 'label' | 'content', value: string) => {
    const nextValue = value;
    setCandidates((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        const updated = { ...c, [field]: nextValue };
        if (field === 'content') {
          seenContents.current.delete(c.content.toLowerCase());
          if (nextValue.trim()) {
            seenContents.current.add(nextValue.trim().toLowerCase());
          }
        }
        return updated;
      }),
    );
  };

  const handleCreateManual = () => {
    setError(null);
    const content = draftNew.content.trim();
    const label = (draftNew.label || toLabel(content)).trim();
    if (!content) {
      setError('?댁슜???낅젰??二쇱꽭??');
      return;
    }
    if (!label) {
      setError('?쇰꺼???낅젰??二쇱꽭??');
      return;
    }
    const candidate = buildCandidateNode(
      convoId,
      { label, content },
      { isSeed: true, message: latestMessage ?? undefined },
    );
    seenContents.current.add(candidate.content.toLowerCase());
    setCandidates((prev) => [candidate, ...prev]);
    setDraftNew({ label: '', content: '' });
  };

  return (
    <div className="flex h-full w-full flex-col gap-2 p-3">
      <div className="text-sm font-semibold text-text-primary">
        {localize('com_sidepanel_candidates') || 'Candidates'}
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}

      <div className="rounded-md border border-border-light bg-surface-secondary p-2">
        <div className="mb-1 text-xs font-semibold text-text-primary">새 임시 노드</div>
        <div className="flex flex-col gap-2">
          <input
            className="w-full rounded border border-border-light bg-background p-2 text-sm text-text-primary outline-none focus:border-accent"
            placeholder="라벨 (예: 아이디어 요약)"
            value={draftNew.label}
            onChange={(e) => setDraftNew((prev) => ({ ...prev, label: e.target.value }))}
          />
          <textarea
            className="min-h-[80px] w-full rounded border border-border-light bg-background p-2 text-sm text-text-primary outline-none focus:border-accent"
            placeholder="내용을 입력하시오"
            value={draftNew.content}
            onChange={(e) => setDraftNew((prev) => ({ ...prev, content: e.target.value }))}
          />
          <div className="flex justify-end">
            <Button size="sm" onClick={handleCreateManual}>
              임시 노드 추가
            </Button>
          </div>
        </div>
      </div>

      <div className="hide-scrollbar flex-1 overflow-auto">
        {candidates.map((candidate) => (
          <div
            key={candidate.id}
            className="mb-2 flex flex-col rounded-md border border-border-light bg-surface-secondary px-2 py-1 text-sm text-white"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-text-secondary">임시 노드</span>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  onClick={() => handleMove(candidate)}
                  disabled={pendingId === candidate.id}
                >
                  {pendingId === candidate.id
                    ? localize('com_ui_saving') || 'Saving...'
                    : localize('com_sidepanel_move_to_graph') || 'Move to graph'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="shrink-0 text-xs text-red-400"
                  onClick={() => handleDeleteCandidate(candidate)}
                >
                  삭제
                </Button>
              </div>
            </div>
            <input
              className="mt-2 w-full rounded border border-border-light bg-background p-2 text-sm font-medium text-text-primary outline-none focus:border-accent"
              value={candidate.label}
              onChange={(e) => handleUpdateCandidate(candidate.id, 'label', e.target.value)}
              placeholder="라벨"
            />
            <textarea
              className="mt-2 min-h-[80px] w-full rounded border border-border-light bg-background p-2 text-xs text-text-secondary outline-none focus:border-accent"
              value={candidate.content}
              onChange={(e) => handleUpdateCandidate(candidate.id, 'content', e.target.value)}
              placeholder="내용을 수정하거나 구체화하세요."
            />
            {candidate.isSeed && (
              <span className="mt-1 text-[10px] uppercase tracking-wide text-accent">seed</span>
            )}
          </div>
        ))}
        {candidates.length === 0 && (
          <div className="p-2 text-sm text-text-secondary">
            {localize('com_sidepanel_no_candidates') || 'No candidates yet'}
          </div>
        )}
      </div>
    </div>
  );
}
