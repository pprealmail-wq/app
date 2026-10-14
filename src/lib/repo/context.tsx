import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import type { LocalRepo } from './localRepo';

const Ctx = createContext<LocalRepo | null>(null);

export function RepoProvider({ repo, children }: { repo: LocalRepo; children: ReactNode }) {
  return <Ctx.Provider value={repo}>{children}</Ctx.Provider>;
}

/** The data layer. Components using it re-render whenever data or the signed-in user changes. */
export function useRepo(): LocalRepo {
  const repo = useContext(Ctx);
  if (!repo) throw new Error('RepoProvider missing');
  useSyncExternalStore(
    (cb) => repo.subscribe(cb),
    () => repo.version,
  );
  return repo;
}
