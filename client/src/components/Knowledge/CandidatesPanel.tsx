import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRecoilState, useRecoilValue } from 'recoil';
import type { TMessage } from 'librechat-data-provider';

import { Button } from '~/components';
import { useLocalize } from '~/hooks';
import store from '~/store';
import type { CandidateNode } from '~/store/knowledgeGraph';
import { createGraphNode } from '~/api/kgraph';

const MAX_CANDIDATES = 8;
const DEFAULT_TOPICS = ['환경 제어', '대체 습관', '목표 설정', '출퇴근 대체 습관', '취침 전 루틴'];

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
  let t = toLine(s)
    .split(' - ')[0]
    .split(' — ')[0]
    .split(':')[0]
    .split('|')[0];
  t = t.split(/[.!?]/)[0].trim();
  t = t.replace(/^\*+\s*/, '').trim();
  if (t.length > 40) {
    t = `${t.slice(0, 37)}…`;
  }
  return t;
};

const buildExtracted = (raw: string): ExtractedCandidate | null => {
  const content = toLine(raw);
  if (!content) return null;
  const label = toLabel(content) || content.slice(0, 40);
  if (!label) return null;
  return { content, label };
};

const extractFromText = (text: string) => {
  if (!text) return [] as ExtractedCandidate[];
  const bulletRe = /^(?:\s*)(?:\d+[\.)]|[-*])\s+(.*)$/;
  const headingRe = /^(?:\s*)(?:#{1,6}\s*)(.+)$/;
  const out: ExtractedCandidate[] = [];
  const seen = new Set<string>();

  const addCandidate = (raw: string) => {
    const candidate = buildExtracted(raw);
    if (!candidate) return;
    const key = candidate.content.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(candidate);
  };

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
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

const extractFromMessage = (message: TMessage | null) => {
  if (!message) return [] as ExtractedCandidate[];
  let text = '';
  if (typeof (message as any).text === 'string' && (message as any).text.trim()) {
    text = (message as any).text as string;
  } else if (Array.isArray((message as any).content)) {
    text = (message as any).content
      .map((part: any) => (part?.type === 'text' ? part.text : typeof part === 'string' ? part : ''))
      .filter(Boolean)
      .join('\n');
  }

  return extractFromText(text);
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

const DEFAULT_CANDIDATE = (convoId: string): CandidateNode[] =>
  DEFAULT_TOPICS.map((label, index) => ({
    id: `seed-${convoId}-${index}`,
    label,
    content: label,
    source_conversation_id: convoId,
    isSeed: true,
  }));

export default function CandidatesPanel() {
  const localize = useLocalize();
  const conversation = useRecoilValue(store.conversation);
  const convoId = conversation?.conversationId ?? 'default';
  const latestMessage = useRecoilValue(store.latestMessage);
  const messages = useRecoilValue(store.messages);
  const [candidates, setCandidates] = useRecoilState(store.candidateNodesByConvo(convoId));
  const [, setGraphNodes] = useRecoilState(store.knowledgeNodesByConvo(convoId));
  const seededConvos = useRef<Set<string>>(new Set());
  const lastHandledMessage = useRef<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const lastAssistant = useMemo(() => {
    const arr = Array.isArray(messages) ? messages : [];
    for (let i = arr.length - 1; i >= 0; i--) {
      const m = arr[i];
      if (m && !m.isCreatedByUser) return m as TMessage;
    }
    return latestMessage && !(latestMessage as any).isCreatedByUser ? (latestMessage as TMessage) : null;
  }, [messages, latestMessage?.messageId]);

  const mergeCandidates = useCallback(
    (extracted: ExtractedCandidate[], message?: TMessage) => {
      if (!extracted.length) return;
      setCandidates((prev) => {
        const existing = new Set(prev.map((c) => c.content.toLowerCase()));
        const additions = extracted
          .map((candidate) => buildCandidateNode(convoId, candidate, { message }))
          .filter((candidate) => {
            const key = candidate.content.toLowerCase();
            if (existing.has(key)) return false;
            existing.add(key);
            return true;
          });
        return additions.length ? [...prev, ...additions] : prev;
      });
    },
    [convoId, setCandidates],
  );

  useEffect(() => {
    const message = lastAssistant;
    if (!message?.messageId) return;
    if (lastHandledMessage.current === message.messageId) return;
    const extracted = extractFromMessage(message);
    mergeCandidates(extracted, message);
    lastHandledMessage.current = message.messageId;
  }, [lastAssistant, mergeCandidates]);

  useEffect(() => {
    if (candidates.length === 0 && !seededConvos.current.has(convoId)) {
      setCandidates(DEFAULT_CANDIDATE(convoId));
      seededConvos.current.add(convoId);
    }
  }, [candidates.length, convoId, setCandidates]);

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
      // ignore observer errors in unsupported environments
    }

    return () => observer.disconnect();
  }, [mergeCandidates]);

  const handleMove = async (candidate: CandidateNode) => {
    setPendingId(candidate.id);
    setError(null);
    try {
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
      setGraphNodes((prev) => [...prev, newNode]);
      if (!candidate.isSeed) {
        setCandidates((prev) => prev.filter((item) => item.id !== candidate.id));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add node');
    } finally {
      setPendingId(null);
    }
  };

  return (
    <div className="flex h-full w-full flex-col gap-2 p-3">
      <div className="text-sm font-semibold text-text-primary">
        {localize('com_sidepanel_candidates') || 'Candidates'}
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="hide-scrollbar flex-1 overflow-auto">
        {candidates.map((candidate) => (
          <div
            key={candidate.id}
            className="mb-2 flex flex-col rounded-md border border-border-light bg-surface-secondary px-2 py-1 text-sm text-white"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-text-primary/90 font-medium">{candidate.label}</span>
              <Button
                size="sm"
                variant="outline"
                className="ml-2 shrink-0"
                onClick={() => handleMove(candidate)}
                disabled={pendingId === candidate.id}
              >
                {pendingId === candidate.id
                  ? localize('com_ui_saving') || 'Saving…'
                  : localize('com_sidepanel_move_to_graph') || 'Move to graph'}
              </Button>
            </div>
            <p className="mt-1 text-xs text-text-secondary">
              {candidate.content.length > 140
                ? `${candidate.content.slice(0, 137)}…`
                : candidate.content}
            </p>
          </div>
        ))}
        {candidates.length === 0 && (
          <div className="p-2 text-sm text-text-secondary">No candidates</div>
        )}
      </div>
    </div>
  );
}
