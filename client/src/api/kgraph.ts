import { request } from 'librechat-data-provider';
import type { GraphNode, GraphEdge } from '~/store/knowledgeGraph';

export type CreateNodePayload = {
  label: string | string[];
  labels?: string[];
  content?: string;
  idea_text?: string;
  x?: number | null;
  y?: number | null;
  source_message_id?: string;
  source_conversation_id?: string;
  vector_ref?: unknown;
};

export type UpdateNodePayload = Partial<Omit<CreateNodePayload, 'label'>> & {
  labels?: string[];
};

export type CreateEdgePayload = {
  source: string;
  target: string;
  label?: string | string[];
};

export type UpdateEdgePayload = {
  source: string;
  target: string;
  label: string | string[];
};

type GraphResponse = {
  nodes?: any[];
  edges?: any[];
};

const ensureArray = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string' && v.length > 0);
  }
  if (typeof value === 'string' && value.length > 0) {
    return [value];
  }
  return [];
};

const normalizeNode = (node: any): GraphNode => ({
  id: node?.id ?? node?._id ?? crypto.randomUUID?.() ?? String(Date.now()),
  content: node?.content ?? node?.idea_text ?? '',
  labels: ensureArray(node?.labels ?? node?.label),
  x: typeof node?.x === 'number' ? node.x : null,
  y: typeof node?.y === 'number' ? node.y : null,
  source_message_id: node?.source_message_id ?? node?.source_messageId,
  source_conversation_id: node?.source_conversation_id ?? node?.source_conversationId,
});

const normalizeEdge = (edge: any): GraphEdge => ({
  id: edge?.id ?? edge?._id ?? crypto.randomUUID?.() ?? String(Date.now()),
  source: edge?.source,
  target: edge?.target,
  labels: ensureArray(edge?.labels ?? edge?.label),
});

export async function fetchKnowledgeGraph(
  conversationId?: string,
): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
  const query = conversationId ? `?conversationId=${encodeURIComponent(conversationId)}` : '';
  const data = await request.get(`/api/kgraphs${query}`);
  return {
    nodes: (data?.nodes || []).map(normalizeNode),
    edges: (data?.edges || []).map(normalizeEdge),
  };
}

export async function createGraphNode(payload: CreateNodePayload): Promise<GraphNode> {
  const data = await request.post('/api/kgraphs/nodes', payload);
  return normalizeNode(data);
}

export async function updateGraphNode(nodeId: string, payload: UpdateNodePayload) {
  const data = await request.patch(`/api/kgraphs/nodes/${nodeId}`, payload);
  return normalizeNode(data);
}

export async function deleteGraphNodes(nodeIds: string[]): Promise<void> {
  if (!nodeIds.length) {
    return;
  }
  await request.post('/api/kgraphs/nodes/delete', { nodeIds });
}

export async function createGraphEdge(payload: CreateEdgePayload): Promise<GraphEdge> {
  const data = await request.post('/api/kgraphs/edges', payload);
  return normalizeEdge(data);
}

export async function updateGraphEdge(payload: UpdateEdgePayload): Promise<GraphEdge> {
  const data = await request.patch('/api/kgraphs/edges', payload);
  return normalizeEdge(data);
}

export async function deleteGraphEdge(source: string, target: string): Promise<void> {
  await request.post('/api/kgraphs/edges/delete', { source, target });
}

export async function requestUmapUpdate() {
  return request.post('/api/kgraphs/umap');
}

export async function requestClusterUpdate() {
  return request.post('/api/kgraphs/cluster');
}

export async function fetchGraphRecommendations(
  method: 'least_similar' | 'synonyms' | 'node_tag' | 'edge_analogy' | 'old_ones',
  params: Record<string, string | number>,
): Promise<string[]> {
  const query = new URLSearchParams({
    method,
    ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
  });
  const data = await request.get(`/api/kgraphs/recommendations?${query.toString()}`);
  return (data as string[]) || [];
}
