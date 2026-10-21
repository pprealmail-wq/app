import { useState } from 'react';
import { useI18n, type Key } from '../../i18n';
import { useInsights } from '../alerts/useInsights';
import { useRepo } from '../../lib/repo/context';

export function ProductDetail({ id }: { id: string }) {
  const { t, num, date, dateTime } = useI18n();
  const repo = useRepo();
  const p = repo.getProduct(id);
  const insights = useInsights();
  if (!p) {
    return (
      <div className="stack">
        <a href="#/products">← {t('back')}</a>
        <p className="center muted">{t('notFound')}</p>
      </div>
    );
  }
  const moves = repo.movementsOf(p.id, 50);
  const ins = insights.items.find((i) => i.product.id === p.id);
  const owner = repo.user!.role === 'owner';
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
      <Adjust key={p.id} id={p.id} onHand={p.onHand} level={p.lowStockManual} auto={ins?.reorderPoint ?? null} owner={owner} />
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

function toInt(v: string): number | null {
  return /^\d+$/.test(v.trim()) ? Number(v.trim()) : null;
}

function Adjust({ id, onHand, level, auto, owner }: { id: string; onHand: number; level: number | null; auto: number | null; owner: boolean }) {
  const { t } = useI18n();
  const repo = useRepo();
  const [count, setCount] = useState(String(onHand));
  const [wo, setWo] = useState('');
  const [reason, setReason] = useState<'damaged' | 'lost' | 'other'>('damaged');
  const [thr, setThr] = useState(level === null ? '' : String(level));
  const [msg, setMsg] = useState<string | null>(null);
  const run = async (fn: () => Promise<string | void>) => {
    try {
      setMsg((await fn()) ?? t('saved'));
    } catch {
      setMsg(t('invalidNumber'));
    }
  };
  return (
    <div className="stack">
      <div className="card stack">
        <h3>{t('countTitle')}</h3>
        <label>
          {t('countLabel')}
          <input type="number" inputMode="numeric" min={0} value={count} onChange={(e) => setCount(e.target.value)} />
        </label>
        <button onClick={() => run(async () => {
          const n = toInt(count);
          if (n === null) throw new Error('bad');
          const d = await repo.recordCount(id, n);
          setCount(String(n));
          return t('countDone', { diff: d > 0 ? `+${d}` : String(d) });
        })}>{t('countSave')}</button>
      </div>
      <div className="card stack">
        <h3>{t('writeOffTitle')}</h3>
        <div className="seg">
          {(['damaged', 'lost', 'other'] as const).map((r) => (
            <button key={r} type="button" className={reason === r ? 'on' : ''} onClick={() => setReason(r)}>
              {t(r === 'damaged' ? 'reasonDamaged' : r === 'lost' ? 'reasonLost' : 'reasonOther')}
            </button>
          ))}
        </div>
        <label>
          {t('writeOffQty')}
          <input type="number" inputMode="numeric" min={1} value={wo} onChange={(e) => setWo(e.target.value)} />
        </label>
        <button onClick={() => run(async () => {
          const n = toInt(wo);
          if (n === null || n === 0) throw new Error('bad');
          await repo.recordWriteOff(id, n, reason);
          setWo('');
        })}>{t('writeOffSave')}</button>
      </div>
      {owner && (
        <div className="card stack">
          <h3>{t('thresholdTitle')}</h3>
          <p className="muted small">{level === null ? `${t('thresholdAuto')}${auto !== null ? `: ${auto}` : ''}` : ''}</p>
          <input type="number" inputMode="numeric" min={0} value={thr} placeholder={t('thresholdAuto')} onChange={(e) => setThr(e.target.value)} />
          <div className="row gap">
            <button className="primary" onClick={() => run(async () => {
              const n = toInt(thr);
              if (n === null) throw new Error('bad');
              await repo.setLowStockManual(id, n);
            })}>{t('thresholdSave')}</button>
            <button onClick={() => run(async () => { await repo.setLowStockManual(id, null); setThr(''); })}>{t('thresholdClear')}</button>
          </div>
        </div>
      )}
      {msg && <p className="notice" role="status">{msg}</p>}
    </div>
  );
}
