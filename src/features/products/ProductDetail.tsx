import { useI18n, type Key } from '../../i18n';
import { useRepo } from '../../lib/repo/context';

export function ProductDetail({ id }: { id: string }) {
  const { t, num, date, dateTime } = useI18n();
  const repo = useRepo();
  const p = repo.getProduct(id);
  if (!p) {
    return (
      <div className="stack">
        <a href="#/products">← {t('back')}</a>
        <p className="center muted">{t('notFound')}</p>
      </div>
    );
  }
  const moves = repo.movementsOf(p.id, 50);
  return (
    <div className="stack">
      <a href="#/products">← {t('back')}</a>
      <div className="card stack">
        <h2>{p.nameTh}</h2>
        <p className={`big ${p.onHand < 0 ? 'neg' : ''}`}>
          {num(p.onHand)} <small>{p.unitName}</small>
        </p>
        {p.onHand < 0 && <p className="notice warn">{t('negativeWarn')}</p>}
        <dl className="facts">
          <dt>{t('code')}</dt>
          <dd>{p.itemCode}</dd>
          <dt>{t('category')}</dt>
          <dd>{p.category ?? t('none')}</dd>
          <dt>{t('price')}</dt>
          <dd>{p.sellPrice !== null ? num(p.sellPrice) : t('none')}</dd>
          <dt>{t('lastSale')}</dt>
          <dd>{date(p.lastSaleAt)}</dd>
        </dl>
      </div>
      <h3>{t('recentMovements')}</h3>
      {moves.length === 0 && <p className="muted">{t('noMovements')}</p>}
      <ul className="list">
        {moves.map((m) => (
          <li key={m.id} className="mv">
            <div>
              <div>{t(`type_${m.type}` as Key)}</div>
              <div className="muted small">
                {m.occurredAt.startsWith('1970') ? t('none') : dateTime(m.occurredAt)}
                {m.receiptNo ? ` · ${m.receiptNo}` : ''}
              </div>
            </div>
            <div className={`qty ${m.quantity < 0 ? 'neg' : 'pos'}`}>{m.quantity > 0 ? `+${num(m.quantity)}` : num(m.quantity)}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}
