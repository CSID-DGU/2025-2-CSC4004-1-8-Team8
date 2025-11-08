import { useMemo, useCallback } from 'react';
import { useRecoilState } from 'recoil';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  addEdge,
  type Connection,
  type Edge as RFEdge,
  type Node as RFNode,
} from 'reactflow';
import 'reactflow/dist/style.css';
import store from '~/store';
import { Button } from '~/components';
import { useLocalize } from '~/hooks';

export default function GraphPanel() {
  const localize = useLocalize();
  const [nodes, setNodes] = useRecoilState(store.knowledgeNodesState);
  const [edges, setEdges] = useRecoilState(store.knowledgeEdgesState);

  const rfNodes: RFNode[] = useMemo(() => {
    // simple grid layout to visualize without external layout engines
    const gapX = 220;
    const gapY = 140;
    return nodes.map((n, i) => ({
      id: n.id,
      data: { label: n.label },
      position: { x: (i % 3) * gapX, y: Math.floor(i / 3) * gapY },
    }));
  }, [nodes]);

  const rfEdges: RFEdge[] = useMemo(
    () =>
      edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        label: e.label,
        animated: true,
      })),
    [edges],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) {
        return;
      }
      const id = `e_${edges.length + 1}`;
      setEdges((prev) => [...prev, { id, source: connection.source!, target: connection.target! }]);
    },
    [edges.length, setEdges],
  );

  const clearAll = () => {
    setNodes([]);
    setEdges([]);
  };

  return (
    <div className="flex h-full w-full flex-col p-2">
      <div className="mb-2 flex items-center justify-between px-1">
        <div className="text-sm font-semibold text-text-primary">
          {localize('com_sidepanel_knowledge_graph') || 'Knowledge Graph'}
        </div>
        <Button size="sm" variant="outline" onClick={clearAll}>
          Clear
        </Button>
      </div>

      <div className="relative h-[60vh] min-h-[300px] overflow-hidden rounded-md border border-border-light">
        <ReactFlow nodes={rfNodes} edges={rfEdges} onConnect={onConnect} fitView>
          <MiniMap />
          <Controls />
          <Background />
        </ReactFlow>
      </div>
    </div>
  );
}
