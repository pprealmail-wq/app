import { useState } from 'react';
import { useI18n, type Key } from '../../i18n';
import { useRepo } from '../../lib/repo/context';
import type { Settings as S } from '../../lib/rules';

const FIELDS: { k: keyof S; label: Key }[] = [
  { k: 'leadTimeDays', label: 'setLead' },
  { k: 'safetyDays', label: 'setSafety' },
  { k: 'orderCoverDays', label: 'setCover' },
  { k: 'historyDays', label: 'setHistory' },
  { k: 'minHistoryDays', label: 'setMinHistory' },
  { k: 'slowMoverDays', label: 'setSlow' },
];

export function Settings() {
  const { t } = useI18n();
  const repo = useRepo();
  const [v, setV] = useState<Record<string, string>>(() => Object.fromEntries(FIELDS.map((f) => [f.k, String(repo.settings()[f.k])])));
  const [msg, setMsg] = useState<string | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await repo.updateSettings(Object.fromEntries(FIELDS.map((f) => [f.k, Number(v[f.k])])) as Partial<S>);
      setMsg(t('saved'));
    } catch {
      setMsg(t('invalidNumber'));
    }
  };

  return (
    <form className="stack" onSubmit={save}>
      <a href="#/alerts">← {t('back')}</a>
      <h2>{t('settingsTitle')}</h2>
      {FIELDS.map((f) => (
        <label key={f.k}>
          {t(f.label)}
          <input type="number" inputMode="numeric" min={0} value={v[f.k]} onChange={(e) => setV({ ...v, [f.k]: e.target.value })} />
        </label>
      ))}
      {msg && <p className="notice" role="status">{msg}</p>}
      <button className="primary">{t('save')}</button>
    </form>
  );
}
