import { useDeferredValue, useState } from 'react';
import { useI18n } from '../../i18n';
import { useRepo } from '../../lib/repo/context';

export function Products() {
  const { t, num } = useI18n();
  const repo = useRepo();
  const [q, setQ] = useState('');
  const dq = useDeferredValue(q);
  const { items, total } = repo.searchProducts(dq, 100);

  return (
    <div className="stack">
      <input type="search" className="search" placeholder={t('searchPlaceholder')} value={q} onChange={(e) => setQ(e.target.value)} />
      <p className="muted small">{t('showing', { n: items.length, total })}</p>
      {items.length === 0 && <p className="center muted">{t('notFound')}</p>}
      <ul className="list">
        {items.map((p) => (
          <li key={p.id}>
            <a href={`#/products/${encodeURIComponent(p.id)}`}>
              <div>
                <div className="name">{p.nameTh}</div>
                <div className="muted small">
                  {p.itemCode}
                  {p.category ? ` · ${p.category}` : ''}
                </div>
              </div>
              <div className={`qty ${p.onHand < 0 ? 'neg' : ''}`}>
                {num(p.onHand)}
                <small> {p.unitName}</small>
              </div>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
