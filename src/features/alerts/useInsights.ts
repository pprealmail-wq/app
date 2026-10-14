import { useMemo } from 'react';
import { useRepo } from '../../lib/repo/context';
import { computeInsights, type InsightSet } from '../../lib/rules';

export function useInsights(): InsightSet {
  const repo = useRepo();
  return useMemo(() => computeInsights(repo.products(), repo.movementsAll(), repo.receipts(), repo.settings()), [repo, repo.version]);
}

export const alertCount = (r: InsightSet): number => r.items.filter((i) => i.urgent || i.low || i.check).length;
