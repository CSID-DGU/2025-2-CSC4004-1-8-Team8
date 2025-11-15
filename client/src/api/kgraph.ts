import type { GraphNode, GraphEdge } from '~/store/knowledgeGraph';

const API_BASE = (import.meta as any).env?.VITE_API_BASE ?? '';
const api = (path: string) => `${API_BASE.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`;

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

export type CreateEdgePayload = {
  source: string;
  target: string;
  labels?: string[];
};

type GraphResponse = {
  nodes?: any[];
  edges?: any[];
};

const jsonHeaders = {
  'Content-Type': 'application/json',
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

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: 'include',
    ...init,
    headers: { ...(init?.headers || {}), 'Content-Type': 'application/json' },
  });

  const text = await res.text();

  if (!res.ok) {
    let message = res.statusText;
    try {
      const data = JSON.parse(text);
      if (data?.message) message = data.message;
    } catch (_) {
      // keep default message
    }
    throw new Error(message || 'Request failed');
  }

  if (res.status === 204) {
    return undefined as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch (err) {
    // Surface unexpected HTML/redirect bodies for debugging
    throw new Error(`Invalid JSON response: ${text.slice(0, 200)}`);
  }
}

export async function fetchKnowledgeGraph(): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
  const data = await request<GraphResponse>(api('/api/kgraphs'));
  return {
    nodes: (data.nodes || []).map(normalizeNode),
    edges: (data.edges || []).map(normalizeEdge),
  };
}

export async function createGraphNode(payload: CreateNodePayload): Promise<GraphNode> {
  const body = JSON.stringify(payload);
  const data = await request<any>(api('/api/kgraphs/nodes'), {
    method: 'POST',
    headers: jsonHeaders,
    body,
  });
  return normalizeNode(data);
}

export async function deleteGraphNodes(nodeIds: string[]): Promise<void> {
  if (!nodeIds.length) return;
  await request<void>(api('/api/kgraphs/nodes/delete'), {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ nodeIds }),
  });
}

export async function createGraphEdge(payload: CreateEdgePayload): Promise<GraphEdge> {
  const body = JSON.stringify(payload);
  const data = await request<any>(api('/api/kgraphs/edges'), {
    method: 'POST',
    headers: jsonHeaders,
    body,
  });
  return normalizeEdge(data);
}
