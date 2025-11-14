import { atom } from 'recoil';

export type GraphNode = {
  id: string;
  label: string;
};

export type GraphEdge = {
  id: string;
  source: string;
  target: string;
  label?: string;
};

export const knowledgeNodesState = atom<GraphNode[]>({
  key: 'knowledgeNodesState',
  default: [],
});

export const knowledgeEdgesState = atom<GraphEdge[]>({
  key: 'knowledgeEdgesState',
  default: [],
});

export const candidateNodesState = atom<string[]>({
  key: 'candidateNodesState',
  default: [],
});

