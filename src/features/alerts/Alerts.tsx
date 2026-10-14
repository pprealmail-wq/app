import { useState } from 'react';
import { useI18n } from '../../i18n';
import { useRepo } from '../../lib/repo/context';
import type { Insight } from '../../lib/rules';
import { useInsights } from './useInsights';

type Tab = 'urgent' | 'low' | 'check' | 'slow';
const PAGE = 50;

export function Alerts() {
  const { t, num, date } = useI18n();
  const repo = useRepo();
  const r = useInsights();
  const [tab, setTab] = useState<Tab>('urgent');
  const [shown, setShown] = useState(PAGE);

  const lists: Record<Tab, Insight[]> = {
    urgent: r.items.filter((i) => i.urgent).sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0)),
    low: r.items.filter((i) => i.low && !i.urgent).sort((a, b) => a.product.onHand / Math.max(1, a.reorderPoint ?? 1) - b.product.onHand / Math.max(1, b.reorderPoint ?? 1)),
    check: r.items.filter((i) => i.check).sort((a, b) => a.product.onHand - b.product.onHand),
    slow: r.items.filter((i) => i.slow).sort((a, b) => b.product.onHand - a.product.onHand),
  };
  const tabs: { id: Tab; label: Parameters<typeof t>[0] }[] = [
    { id: 'urgent', label: 'tabUrgent' },
    { id: 'low', label: 'tabLow' },
    { id: 'check', label: 'tabCheck' },
    { id: 'slow', label: 'tabSlow' },
  ];
  const list = lists[tab];

  if (r.asOf === null) {
    return (
      <div className="stack">
        <h2>{t('alertsTitle')}</h2>
        <p className="center muted">{t('noData')}</p>
      </div>
    );
  }

  return (
    <div className="stack">
      <h2>{t('alertsTitle')}</h2>
      <p className="muted small">
        {t('alertsAsOf')} {date(r.asOf)}
      </p>
      {!r.enoughHistory && (
        <p className="notice warn">
          {t('notEnoughHistory', { n: r.coveredDays, min: repo.settings().minHistoryDays })}
          {repo.user?.role === 'owner' && (
            <>
              {' '}
              <a href="#/settings">{t('goSettings')}</a>
            </>
          )}
        </p>
      )}
      <div className="tabs" role="tablist">
        {tabs.map((x) => (
          <button key={x.id} role="tab" aria-selected={tab === x.id} className={tab === x.id ? 'on' : ''} onClick={() => { setTab(x.id); setShown(PAGE); }}>
            {t(x.label)} <span className="count">{lists[x.id].length}</span>
          </button>
        ))}
      </div>
      {list.length === 0 && <p className="center muted">{t('noneInList')}</p>}
      <ul className="list">
        {list.slice(0, shown).map((i) => (
          <li key={i.product.id}>
            <a href={`#/products/${encodeURIComponent(i.product.id)}`}>
              <div>
                <div className="name">{i.product.nameTh}</div>
                <div className="muted small">
                  {i.product.onHand <= 0 && tab === 'urgent' ? `${t('outOfStock')} · ` : ''}
                  {i.avg > 0 ? t('avgPerDay', { n: Math.round(i.avg * 10) / 10 }) : t('neverSold')}
                  {i.daysLeft !== null && i.daysLeft < 30 ? ` · ${t('daysLeft', { n: Math.round(i.daysLeft * 10) / 10 })}` : ''}
                  {i.reorderPoint !== null ? ` · ${t('reorderAt', { n: i.reorderPoint })}` : ''}
                </div>
              </div>
              <div className={`qty ${i.product.onHand <= 0 ? 'neg' : ''}`}>
                {num(i.product.onHand)}
                <small> {i.product.unitName}</small>
              </div>
            </a>
          </li>
        ))}
      </ul>
      {list.length > shown && <button onClick={() => setShown(shown + PAGE)}>{t('showMore')}</button>}
    </div>
  );
}
