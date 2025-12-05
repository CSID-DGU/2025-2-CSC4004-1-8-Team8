import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRecoilState, useRecoilValue } from 'recoil';
import ReactFlow, {
  Background,
  type Connection,
  type Edge as RFEdge,
  type Node as RFNode,
} from 'reactflow';
import 'reactflow/dist/style.css';

import { Button } from '~/components';
import { useLocalize } from '~/hooks';
import store from '~/store';
import {
  fetchKnowledgeGraph,
  deleteGraphNodes,
  createGraphEdge,
  updateGraphNode,
  updateGraphEdge,
  deleteGraphEdge,
  createGraphNode,
  requestClusterUpdate,
  fetchGraphRecommendations,
} from '~/api/kgraph';
import type { GraphNode } from '~/store/knowledgeGraph';

const DEFAULT_EDGE_LABELS = [
  '원인-결과',
  '문제-해결',
  '필요-수단',
  '목표-과제',
  '조건-결론',
  '구성-구성요소',
  '사례-참고',
  '대안-선택지',
  '유사/연관',
  '대비/충돌',
  '선행-후행',
  '요구-지원',
];

const convoScope = (node: GraphNode, fallback = 'default') =>
  node.source_conversation_id ?? fallback;

const resolveConvoId = (
  conversation: any,
  messages: any[] | null | undefined,
  fallback = 'default',
) => {
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
  return fallback;
};

export default function GraphPanel() {
  const localize = useLocalize();
  const conversation = useRecoilValue(store.conversation);
  const messages = useRecoilValue(store.messages);
  const latestMessage = useRecoilValue(store.latestMessage);
  const convoId = resolveConvoId(
    conversation,
    messages,
    latestMessage?.conversationId ?? 'default',
  );
  const [nodes, setNodes] = useRecoilState(store.knowledgeNodesByConvo(convoId));
  const [edges, setEdges] = useRecoilState(store.knowledgeEdgesByConvo(convoId));
  const [loading, setLoading] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [selectedEdge, setSelectedEdge] = useState<RFEdge | null>(null);
  const [nodeDraft, setNodeDraft] = useState<{
    label: string;
    content: string;
    labelsText: string;
  }>({
    label: '',
    content: '',
    labelsText: '',
  });
  const [edgeLabelDraft, setEdgeLabelDraft] = useState<string>('');
  const [savingNode, setSavingNode] = useState(false);
  const [savingEdge, setSavingEdge] = useState(false);
  const [positioning, setPositioning] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [recoLoading, setRecoLoading] = useState(false);
  const [recoIds, setRecoIds] = useState<string[]>([]);
  const [recoRequested, setRecoRequested] = useState(false);
  const [recoMethod, setRecoMethod] = useState<'synonyms' | 'edge_analogy'>('synonyms');
  const [edgeLabelInput, setEdgeLabelInput] = useState('');
  const [connectingRecoId, setConnectingRecoId] = useState<string | null>(null);
  const recoItems = useMemo(() => {
    const map = new Map(nodes.map((n) => [n.id, n]));
    return recoIds.map((id) => {
      const node = map.get(id);
      const label =
        (node?.labels?.[0] || '').trim() ||
        (node?.content || '').slice(0, 50) ||
        '제목 없음';
      return { id, label };
    });
  }, [nodes, recoIds]);

  // edge_analogy용 자동 라벨 추천: 기본 라벨 + 현재 그래프 엣지 라벨 빈도 상위
  const edgeLabelSuggestions = useMemo(() => {
    const freq = new Map<string, number>();
    edges.forEach((edge: any) => {
      const labels: string[] = Array.isArray(edge.labels)
        ? edge.labels
        : edge.label
          ? [edge.label]
          : [];
      labels
        .map((l) => (typeof l === 'string' ? l.trim() : ''))
        .filter(Boolean)
        .forEach((l) => {
          freq.set(l, (freq.get(l) || 0) + 1);
        });
    });
    // 기본 라벨에 기본 가중치 부여(등장하지 않은 경우 1로)
    DEFAULT_EDGE_LABELS.forEach((l) => {
      freq.set(l, (freq.get(l) || 0) + 1);
    });

    return Array.from(freq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([l]) => l);
  }, [edges]);

  const loadGraph = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchKnowledgeGraph(showAll ? undefined : convoId);
      // 서버에서 이미 필터링(conversationId 없으면 전체 그래프)
      setNodes(data.nodes);
      setEdges(data.edges as any);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load knowledge graph');
    } finally {
      setLoading(false);
    }
  }, [convoId, setEdges, setNodes, showAll]);

  const repositionGraph = useCallback(async () => {
    setPositioning(true);
    setError(null);
    try {
      await requestClusterUpdate();
      await loadGraph();
    } catch (err) {
      setError(err instanceof Error ? err.message : '좌표 계산에 실패했습니다');
    } finally {
      setPositioning(false);
    }
  }, [loadGraph]);

  const handleRecommendations = useCallback(async () => {
    if (!selectedNodeIds.length) {
      setError('추천을 받을 노드를 선택하세요.');
      return;
    }
    if (recoMethod === 'edge_analogy' && !edgeLabelInput.trim()) {
      setError('edge_analogy를 사용하려면 관계 라벨을 입력하세요.');
      return;
    }
    setRecoLoading(true);
    setRecoRequested(true);
    setError(null);
    try {
      const nodeId = selectedNodeIds[0];
      const params: Record<string, string | number> = { nodeId, top_k: 5 };
      if (recoMethod === 'edge_analogy') {
        params.edge_label = edgeLabelInput.trim();
      }
      const ids = await fetchGraphRecommendations(recoMethod, params);
      setRecoIds(ids);
    } catch (err) {
      setError(err instanceof Error ? err.message : '추천 조회 실패');
      setRecoIds([]);
    } finally {
      setRecoLoading(false);
    }
  }, [selectedNodeIds]);

  useEffect(() => {
    // clear stale state when switching conversations
    setNodes([]);
    setEdges([]);
    loadGraph();
  }, [loadGraph, convoId, setEdges, setNodes, showAll]);

  const toggleScope = () => {
    setShowAll((prev) => !prev);
  };

  const displayNodes: RFNode[] = useMemo(() => {
    const gapX = 260;
    const gapY = 160;
    const pickLabel = (node: GraphNode, fallbackIndex: number) => {
      const labelText = (node.labels?.[0] || '').trim();
      if (labelText) return labelText;
      const contentText = (node.content || '').trim();
      if (contentText) return contentText.slice(0, 80);
      return `Node ${fallbackIndex + 1}`;
    };
    return nodes.map((node, index) => {
      const fallback = { x: (index % 3) * gapX, y: Math.floor(index / 3) * gapY };
      const hasPosition =
        typeof node.x === 'number' && typeof node.y === 'number' && !(node.x === 0 && node.y === 0); // 서버 기본값(0,0)일 때는 겹치지 않게 배치
      return {
        id: node.id,
        data: { label: pickLabel(node, index) },
        position: hasPosition ? { x: node.x!, y: node.y! } : fallback,
        selected: selectedNodeIds.includes(node.id),
      };
    });
  }, [nodes, selectedNodeIds]);

  const displayEdges: RFEdge[] = useMemo(
    () =>
      edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: edge.labels?.[0] || '',
        animated: true,
        selected: selectedEdge?.id === edge.id,
      })),
    [edges, selectedEdge?.id],
  );

  const selectedNodes = useMemo(
    () => nodes.filter((node) => selectedNodeIds.includes(node.id)),
    [nodes, selectedNodeIds],
  );

  useEffect(() => {
    const focusNode = selectedNodes[0];
    if (focusNode) {
      setNodeDraft({
        label: (focusNode.labels?.[0] || '').trim(),
        content: focusNode.content || '',
        labelsText: (focusNode.labels || []).join(', '),
      });
    }
  }, [selectedNodes]);

  useEffect(() => {
    if (selectedEdge) {
      setEdgeLabelDraft(selectedEdge.label || '');
    }
  }, [selectedEdge]);

  const parseLabels = useCallback((raw: string) => {
    return raw
      .split(',')
      .map((v) => v.trim())
      .filter((v) => v.length > 0);
  }, []);

  const onConnect = useCallback(
    async (connection: Connection) => {
      if (!connection.source || !connection.target) {
        return;
      }
      setError(null);
      try {
        const labelInput =
          window.prompt('관계 라벨을 입력하세요 (예: 원인-결과, 문제-해결)', '관계') || '';
        const labels = parseLabels(labelInput);
        const label = labels.length > 1 ? labels : labels[0] || undefined;
        const newEdge = await createGraphEdge({
          source: connection.source,
          target: connection.target,
          label,
        });
        setEdges((prev) => [...prev, newEdge]);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create edge');
      }
    },
    [parseLabels, setEdges],
  );

  const onSelectionChange = useCallback(({ nodes: rfNodes = [], edges: rfEdges = [] }) => {
    setSelectedNodeIds(rfNodes.map((n) => n.id));
    setSelectedEdge(rfEdges[0] ?? null);
  }, []);

  const handleSaveNode = useCallback(async () => {
    setSavingNode(true);
    setError(null);
    const labels = parseLabels(nodeDraft.labelsText || nodeDraft.label);
    try {
      const targetId = selectedNodeIds[0];
      if (targetId) {
        const updated = await updateGraphNode(targetId, {
          content: nodeDraft.content,
          idea_text: nodeDraft.content,
          labels,
        });
        setNodes((prev) =>
          prev.map((node) => (node.id === targetId ? { ...node, ...updated } : node)),
        );
      } else {
        const defaultLabel = nodeDraft.label || nodeDraft.content.slice(0, 40) || '???몃뱶';
        const created = await createGraphNode({
          label: defaultLabel,
          labels: labels.length ? labels : [defaultLabel],
          content: nodeDraft.content,
          idea_text: nodeDraft.content,
          source_conversation_id: convoId,
        });
        setNodes((prev) => [...prev, created]);
        setSelectedNodeIds([created.id]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '노드 저장에 실패했습니다');
    } finally {
      setSavingNode(false);
    }
  }, [
    convoId,
    nodeDraft.content,
    nodeDraft.label,
    nodeDraft.labelsText,
    parseLabels,
    repositionGraph,
    selectedNodeIds,
    setNodes,
  ]);

  const handleDeleteSelectedNodes = useCallback(async () => {
    if (!selectedNodeIds.length) return;
    setSavingNode(true);
    setError(null);
    try {
      await deleteGraphNodes(selectedNodeIds);
      setNodes((prev) => prev.filter((n) => !selectedNodeIds.includes(n.id)));
      setEdges((prev) =>
        prev.filter(
          (e) => !selectedNodeIds.includes(e.source) && !selectedNodeIds.includes(e.target),
        ),
      );
      setSelectedNodeIds([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : '선택 노드 삭제 실패');
    } finally {
      setSavingNode(false);
    }
  }, [selectedNodeIds, setEdges, setNodes]);

  const handleMergeSelected = useCallback(async () => {
    if (selectedNodes.length < 2) return;
    setSavingNode(true);
    setError(null);
    try {
      const mergedContent = selectedNodes.map((n) => `• ${n.content}`).join('\n');
      const mergedLabels = Array.from(
        new Set(selectedNodes.flatMap((n) => n.labels || []).filter((l) => !!l)),
      );
      const defaultLabel = nodeDraft.label || mergedLabels[0] || '병합 노드';
      const created = await createGraphNode({
        label: defaultLabel,
        labels: mergedLabels.length ? mergedLabels : [defaultLabel],
        content: mergedContent,
        idea_text: mergedContent,
        source_conversation_id: convoId,
      });
      await deleteGraphNodes(selectedNodeIds);
      setNodes((prev) => [
        ...prev.filter((n) => !selectedNodeIds.includes(n.id)),
        { ...created, labels: created.labels?.length ? created.labels : [defaultLabel] },
      ]);
      setEdges((prev) =>
        prev.filter(
          (e) => !selectedNodeIds.includes(e.source) && !selectedNodeIds.includes(e.target),
        ),
      );
      setSelectedNodeIds([created.id]);
    } catch (err) {
      setError(err instanceof Error ? err.message : '병합에 실패했습니다');
    } finally {
      setSavingNode(false);
    }
  }, [convoId, nodeDraft.label, selectedNodeIds, selectedNodes, setEdges, setNodes]);

  const handleResetDraft = useCallback(() => {
    setSelectedNodeIds([]);
    setNodeDraft({ label: '', content: '', labelsText: '' });
  }, []);

  const handleSaveEdgeLabel = useCallback(async () => {
    if (!selectedEdge) return;
    setSavingEdge(true);
    setError(null);
    try {
      const labels = parseLabels(edgeLabelDraft || selectedEdge.label || '관련');
      const updated = await updateGraphEdge({
        source: selectedEdge.source,
        target: selectedEdge.target,
        labels,
      });
      setEdges((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
    } catch (err) {
      setError(err instanceof Error ? err.message : '관계 라벨 저장 실패');
    } finally {
      setSavingEdge(false);
    }
  }, [edgeLabelDraft, parseLabels, selectedEdge, setEdges]);

  const handleDeleteSelectedEdge = useCallback(async () => {
    if (!selectedEdge) return;
    setSavingEdge(true);
    setError(null);
    try {
      await deleteGraphEdge(selectedEdge.source, selectedEdge.target);
      setEdges((prev) => prev.filter((e) => e.id !== selectedEdge.id));
      setSelectedEdge(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '관계 삭제 실패');
    } finally {
      setSavingEdge(false);
    }
  }, [selectedEdge, setEdges]);

  // 추천 노드에 바로 엣지 연결
  const handleConnectReco = useCallback(
    async (targetId: string) => {
      if (!selectedNodeIds.length) {
        setError('먼저 기준이 될 노드를 선택하세요.');
        return;
      }
      const sourceId = selectedNodeIds[0];
      const label =
        edgeLabelInput.trim() ||
        edgeLabelSuggestions[0] ||
        '연결';

      setConnectingRecoId(targetId);
      setError(null);
      try {
        const newEdge = await createGraphEdge({
          source: sourceId,
          target: targetId,
          label,
        });
        setEdges((prev) => {
          const map = new Map<string, any>();
          prev.forEach((e: any) => map.set(e.id, e));
          map.set(newEdge.id, newEdge as any);
          return Array.from(map.values()) as any;
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : '추천 노드 연결에 실패했습니다.');
      } finally {
        setConnectingRecoId(null);
      }
    },
    [edgeLabelInput, edgeLabelSuggestions, selectedNodeIds, setEdges],
  );

  const clearAll = useCallback(async () => {
    if (!nodes.length) return;
    setClearing(true);
    setError(null);
    try {
      await deleteGraphNodes(nodes.map((n) => n.id));
      setNodes([]);
      setEdges([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete nodes');
    } finally {
      setClearing(false);
    }
  }, [nodes, setEdges, setNodes]);

  return (
    <div className="flex h-full w-full flex-col p-2">
      <div className="mb-2 flex items-center justify-between px-1">
        <div className="text-sm font-semibold text-text-primary">
          {localize('com_sidepanel_knowledge_graph') || 'Knowledge Graph'}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={toggleScope} disabled={loading}>
            {showAll ? '대화 그래프 보기' : '전체 그래프 보기'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleRecommendations}
            disabled={
              recoLoading ||
              loading ||
              !selectedNodeIds.length ||
              (recoMethod === 'edge_analogy' && !edgeLabelInput.trim())
            }
          >
            {recoLoading ? '추천 불러오는 중...' : '연결 추천'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={repositionGraph}
            disabled={positioning || loading}
          >
            {positioning ? '좌표 계산 중...' : 'UMAP 좌표 갱신'}
          </Button>
          <Button size="sm" variant="outline" onClick={clearAll} disabled={clearing || loading}>
            {clearing ? localize('com_ui_clearing') || 'Clearing...' : 'Clear'}
          </Button>
        </div>
      </div>

      {error && <p className="mb-2 text-xs text-red-500">{error}</p>}

      <div className="relative h-[60vh] min-h-[300px] overflow-hidden rounded-md border border-border-light">
        {loading ? (
          <div className="flex h-full items-center justify-center text-sm text-text-secondary">
            {localize('com_ui_loading') || 'Loading...'}
          </div>
        ) : (
          <ReactFlow
            nodes={displayNodes}
            edges={displayEdges}
            onConnect={onConnect}
            onSelectionChange={onSelectionChange}
            fitView
          >
            <Background />
            {/* <MiniMap pannable />
            <Controls /> */}
          </ReactFlow>
        )}
      </div>

      {recoRequested && (
        <div className="mt-2 rounded-md border border-border-light bg-surface-secondary p-2 text-xs text-text-primary">
          <div className="mb-1 font-semibold">추천 노드</div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <label className="text-[11px] text-text-secondary">추천 방식</label>
            <select
              className="rounded border border-border-light bg-background px-2 py-1 text-[11px]"
              value={recoMethod}
              onChange={(e) => setRecoMethod(e.target.value as 'synonyms' | 'edge_analogy')}
            >
              <option value="synonyms">임베딩 유사도 (synonyms)</option>
              <option value="edge_analogy">관계 유추 (edge_analogy)</option>
            </select>
            {recoMethod === 'edge_analogy' && (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  className="rounded border border-border-light bg-background px-2 py-1 text-[11px] text-text-primary outline-none focus:border-accent"
                  placeholder="관계 라벨을 입력하세요"
                  value={edgeLabelInput}
                  onChange={(e) => setEdgeLabelInput(e.target.value)}
                />
                {edgeLabelSuggestions.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {edgeLabelSuggestions.map((label) => (
                      <button
                        key={label}
                        type="button"
                        className="rounded border border-border-light bg-background px-2 py-1 text-[10px] text-text-secondary hover:border-accent"
                        onClick={() => setEdgeLabelInput(label)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          {recoMethod === 'edge_analogy' && (
            <div className="mb-2 text-[11px] text-text-tertiary">
              라벨 입력이 없으면 추천 라벨 중 첫 번째를 사용합니다.
            </div>
          )}
          {recoItems.length ? (
            <div className="flex flex-wrap gap-2">
              {recoItems.map((item) => (
                <div
                  key={item.id}
                  className="rounded border border-border-light bg-background px-2 py-1 text-[11px] leading-snug text-text-secondary"
                >
                  <div className="font-semibold text-text-primary">{item.label}</div>
                  <div className="font-mono text-[10px] text-text-tertiary">{item.id}</div>
                  <div className="mt-1 flex gap-1">
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={!!connectingRecoId}
                      onClick={() => handleConnectReco(item.id)}
                    >
                      {connectingRecoId === item.id ? '연결 중...' : '연결 추가'}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-text-secondary">추천 결과가 없습니다.</div>
          )}
        </div>
      )}

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div className="rounded-md border border-border-light bg-surface-secondary p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm font-semibold text-text-primary">
              {selectedNodeIds.length ? `선택된 노드 ${selectedNodeIds.length}개` : '새 노드 작성'}
            </div>
            <Button size="sm" variant="ghost" onClick={handleResetDraft}>
              신규로 전환
            </Button>
          </div>
          <div className="flex flex-col gap-2">
            <input
              className="w-full rounded border border-border-light bg-background p-2 text-sm text-text-primary outline-none focus:border-accent"
              placeholder="대표 라벨"
              value={nodeDraft.label}
              onChange={(e) => setNodeDraft((prev) => ({ ...prev, label: e.target.value }))}
            />
            <input
              className="w-full rounded border border-border-light bg-background p-2 text-sm text-text-primary outline-none focus:border-accent"
              placeholder="카테고리/라벨 (쉼표로 구분)"
              value={nodeDraft.labelsText}
              onChange={(e) => setNodeDraft((prev) => ({ ...prev, labelsText: e.target.value }))}
            />
            <textarea
              className="min-h-[120px] w-full rounded border border-border-light bg-background p-2 text-sm text-text-primary outline-none focus:border-accent"
              placeholder="내용을 입력하거나 수정하세요."
              value={nodeDraft.content}
              onChange={(e) => setNodeDraft((prev) => ({ ...prev, content: e.target.value }))}
            />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={handleSaveNode} disabled={savingNode}>
                {savingNode ? '저장 중...' : '노드 저장'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleMergeSelected}
                disabled={savingNode || selectedNodeIds.length < 2}
              >
                중복/유사 노드 병합
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-red-400"
                onClick={handleDeleteSelectedNodes}
                disabled={savingNode || !selectedNodeIds.length}
              >
                선택 노드 삭제
              </Button>
            </div>
          </div>
        </div>

        <div className="rounded-md border border-border-light bg-surface-secondary p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm font-semibold text-text-primary">관계 라벨</div>
            <div className="text-xs text-text-secondary">
              {selectedEdge
                ? `${selectedEdge.source} → ${selectedEdge.target}`
                : '관계를 선택하세요'}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <input
              className="w-full rounded border border-border-light bg-background p-2 text-sm text-text-primary outline-none focus:border-accent"
              placeholder="예: 원인-결과, 문제-해결"
              value={edgeLabelDraft}
              onChange={(e) => setEdgeLabelDraft(e.target.value)}
              disabled={!selectedEdge}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={handleSaveEdgeLabel}
                disabled={savingEdge || !selectedEdge}
              >
                {savingEdge ? '저장 중...' : '라벨 저장'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-red-400"
                onClick={handleDeleteSelectedEdge}
                disabled={savingEdge || !selectedEdge}
              >
                선택 관계 삭제
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
