import { useMemo } from 'react';
import { useRecoilState } from 'recoil';
import { Button } from '~/components';
import { useLocalize } from '~/hooks';
import store from '~/store';

export default function CandidatesPanel() {
  const localize = useLocalize();
  const [candidates, setCandidates] = useRecoilState(store.candidateNodesState);
  const [nodes, setNodes] = useRecoilState(store.knowledgeNodesState);

  const seed = useMemo(
    () =>
      candidates.length === 0
        ? ['환경 제어', '대체 습관', '목표 설정', '출퇴근 대체 습관', '취침 전 루틴']
        : candidates,
    [candidates],
  );

  const addToGraph = (label: string) => {
    setNodes((prev) => {
      if (prev.find((n) => n.label === label)) {
        return prev;
      }
      const id = `n_${(prev.length + 1).toString()}`;
      return [...prev, { id, label }];
    });
  };

  return (
    <div className="flex h-full w-full flex-col gap-2 p-3">
      <div className="text-sm font-semibold text-text-primary">
        {localize('com_sidepanel_candidates') || 'Candidates'}
      </div>
      <div className="hide-scrollbar flex-1 overflow-auto">
        {seed.map((c) => (
          <div
            key={c}
            className="mb-2 flex items-center justify-between rounded-md border border-border-light bg-surface-secondary px-2 py-1 text-sm text-gray-900 dark:text-white"
          >
            <span className="text-text-primary/90">{c}</span>
            <Button size="sm" variant="outline" className="ml-2" onClick={() => addToGraph(c)}>
              {localize('com_sidepanel_move_to_graph') || 'Move to graph'}
            </Button>
          </div>
        ))}
        {seed.length === 0 && <div className="p-2 text-sm text-text-secondary">No candidates</div>}
      </div>
    </div>
  );
}
