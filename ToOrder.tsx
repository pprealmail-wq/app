import { useMemo, useState } from 'react';
import { useI18n } from '../../i18n';
import { useRepo } from '../../lib/repo/context';
import { useInsights } from '../alerts/useInsights';

export function ToOrder() {
  const { t, num, date } = useI18n();
  const r = useInsights();
  const repo = useRepo();
  const [qty, setQty] = useState<Record<string, number>>({});
  const [off, setOff] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState(false);

  const groups = useMemo(() => {
    const m = new Map<string, typeof r.items>();
    for (const i of r.items) {
      if (i.suggested <= 0) continue;
      const c = i.product.category ?? t('none');
      m.set(c, [...(m.get(c) ?? []), i]);
    }
    return [...m].sort((a, b) => a[0].localeCompare(b[0], 'th'));
  }, [r.items, t]);

  const q = (id: string, suggested: number) => qty[id] ?? suggested;
  const selected = groups.flatMap(([, v]) => v).filter((i) => !off[i.product.id] && q(i.product.id, i.suggested) > 0);

  const copy = async () => {
    const lines: string[] = [t('orderHeader', { date: date(r.asOf) })];
    for (const [cat, items] of groups) {
      const ch = items.filter((i) => !off[i.product.id] && q(i.product.id, i.suggested) > 0);
      if (ch.length === 0) continue;
      lines.push('', `[${cat}]`);
      for (const i of ch) lines.push(`${i.product.nameTh} x ${q(i.product.id, i.suggested)} ${i.product.unitName}`);
    }
    const text = lines.join('\n');
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="stack">
      <h2>{t('orderTitle')}</h2>
      <p className="muted">{t('orderHelp')}</p>
      {!r.enoughHistory && r.asOf !== null && <p className="notice warn">{t('notEnoughHistory', { n: r.coveredDays, min: repo.settings().minHistoryDays })}</p>}
      {groups.length === 0 && <p className="center muted">{t('orderNone')}</p>}
      {groups.map(([cat, items]) => (
        <div key={cat} className="stack">
          <h3>{cat}</h3>
          <ul className="list">
            {items.map((i) => (
              <li key={i.product.id} className="ord">
                <label className="check">
                  <input type="checkbox" checked={!off[i.product.id]} onChange={(e) => setOff({ ...off, [i.product.id]: !e.target.checked })} />
                  <span>
                    <span className="name">{i.product.nameTh}</span>
                    <small className="muted block">
                      {t('onHand')} {num(i.product.onHand)} {i.product.unitName}
                    </small>
                  </span>
                </label>
                <input className="qtyin" type="number" inputMode="numeric" min={0} value={q(i.product.id, i.suggested)} onChange={(e) => setQty({ ...qty, [i.product.id]: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} aria-label={t('orderTitle')} />
              </li>
            ))}
          </ul>
        </div>
      ))}
      {groups.length > 0 && (
        <button className="primary sticky" disabled={selected.length === 0} onClick={() => void copy()}>
          {copied ? t('orderCopied') : `${t('orderCopy')} (${t('orderSelected', { n: selected.length })})`}
        </button>
      )}
    </div>
  );
}
