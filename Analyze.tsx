import { useMemo, useState } from 'react';
import { useI18n } from '../../i18n';
import { useRepo } from '../../lib/repo/context';
import { computeAnalytics } from '../../lib/rules';
import { useInsights } from '../alerts/useInsights';

const Bar = ({ pct }: { pct: number }) => (
  <div className="bar" aria-hidden="true">
    <i style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} />
  </div>
);

export function Analyze() {
  const { t, num, date } = useI18n();
  const repo = useRepo();
  const ins = useInsights();
  const a = useMemo(() => computeAnalytics(repo.products(), repo.movementsAll()), [repo, repo.version]);
  const [by, setBy] = useState<'cases' | 'receipts'>('cases');
  const [topN, setTopN] = useState(10);

  if (a.days === 0) {
    return (
      <div className="stack">
        <h2>{t('analyzeTitle')}</h2>
        <p className="center muted">{t('analyzeEmpty')}</p>
      </div>
    );
  }

  const ranked = [...a.products].sort((x, y) => (by === 'cases' ? y.cases - x.cases : y.receipts - x.receipts || y.cases - x.cases));
  const top = ranked.slice(0, topN);
  const topVal = (p: (typeof ranked)[number]) => (by === 'cases' ? p.cases : p.receipts);
  const maxTop = ranked.length ? topVal(ranked[0]) : 1;

  const left = ins.items
    .filter((i) => i.avg > 0 && i.daysLeft !== null)
    .sort((x, y) => (x.daysLeft ?? 0) - (y.daysLeft ?? 0) || y.avg - x.avg)
    .slice(0, 10);

  const maxDay = Math.max(1, ...a.daily.map((d) => Math.max(d.sold, d.received)));
  const maxCat = a.categories.length ? a.categories[0].cases : 1;
  const net = a.totalSold - a.totalReceived;
  const short = a.days < repo.settings().slowMoverDays;

  return (
    <div className="stack">
      <h2>{t('analyzeTitle')}</h2>
      <p className="muted small">{t('analyzeRange', { from: date(a.from), to: date(a.to), n: a.days, sold: num(a.totalSold) })}</p>

      <section className="stack">
        <h3>{t('anBest')}</h3>
        <div className="seg">
          <button className={by === 'cases' ? 'on' : ''} onClick={() => setBy('cases')}>
            {t('anByCases')}
          </button>
          <button className={by === 'receipts' ? 'on' : ''} onClick={() => setBy('receipts')}>
            {t('anByReceipts')}
          </button>
        </div>
        <ul className="list">
          {top.map((p, i) => (
            <li key={p.product.id} className="an">
              <a href={`#/products/${encodeURIComponent(p.product.id)}`}>
                <div className="anrow">
                  <span>
                    {i + 1}. {p.product.nameTh}
                  </span>
                  <b>{num(topVal(p))}</b>
                </div>
                <Bar pct={(topVal(p) / maxTop) * 100} />
                <div className="muted small">
                  {by === 'cases' ? t('anReceiptsN', { n: num(p.receipts) }) : t('anCasesN', { n: num(p.cases) })}
                </div>
              </a>
            </li>
          ))}
        </ul>
        {topN < ranked.length && (
          <button onClick={() => setTopN(topN + 20)}>
            {t('anMore', { shown: topN, total: ranked.length })}
          </button>
        )}
      </section>

      <section className="stack">
        <h3>{t('anDaysLeft')}</h3>
        <p className="muted small">{t('anDaysLeftHelp')}</p>
        {left.length === 0 && <p className="muted">{t('anNone')}</p>}
        <ul className="list">
          {left.map((i) => (
            <li key={i.product.id} className="an">
              <a href={`#/products/${encodeURIComponent(i.product.id)}`}>
                <div className="anrow">
                  <span>{i.product.nameTh}</span>
                  <span className={`chip ${i.product.onHand <= 0 ? 'bad' : (i.daysLeft ?? 99) < 3 ? 'warn' : ''}`}>
                    {i.product.onHand <= 0 ? t('anOut') : t('anDaysN', { n: Math.floor(i.daysLeft ?? 0) })}
                  </span>
                </div>
                <div className="muted small">{t('anAvgLine', { avg: (Math.round(i.avg * 10) / 10).toString(), left: num(i.product.onHand) })}</div>
              </a>
            </li>
          ))}
        </ul>
        {!ins.enoughHistory && <p className="notice warn">{t('notEnoughHistory', { n: ins.coveredDays, min: repo.settings().minHistoryDays })}</p>}
      </section>

      <section className="stack">
        <h3>{t('anDaily')}</h3>
        <div className="row gap small">
          <span className="key sold" /> {t('anSold')}
          <span className="key recv" /> {t('anReceived')}
        </div>
        <div className="card">
          <div className="chart" role="img" aria-label={t('anDaily')}>
            {a.daily.map((d) => (
              <div key={d.date} className="col">
                <div className="pair">
                  <i className="sold" style={{ height: `${(d.sold / maxDay) * 100}%` }} title={`${d.date}: ${d.sold}`} />
                  <i className="recv" style={{ height: `${(d.received / maxDay) * 100}%` }} title={`${d.date}: ${d.received}`} />
                </div>
                <span className="small muted">{d.date.slice(8)}</span>
              </div>
            ))}
          </div>
        </div>
        <ul className="list">
          {a.daily.map((d) => (
            <li key={d.date} className="an">
              <div className="anrow">
                <span>{date(d.date)}</span>
                <span className="small">
                  {t('anSold')} <b>{num(d.sold)}</b> · {t('anReceived')} <b>{num(d.received)}</b>
                </span>
              </div>
            </li>
          ))}
        </ul>
        <p className="muted small">{t(net > 0 ? 'anNetDown' : 'anNetUp', { n: num(Math.abs(net)) })}</p>
      </section>

      <section className="stack">
        <h3>{t('anDead', { n: a.dead.length })}</h3>
        <p className="muted small">{t('anDeadHelp')}</p>
        {short && <p className="notice warn">{t('anShortData', { n: a.days })}</p>}
        <ul className="list">
          {a.dead.slice(0, 10).map((d) => (
            <li key={d.product.id} className="an">
              <a href={`#/products/${encodeURIComponent(d.product.id)}`}>
                <div className="anrow">
                  <span>{d.product.nameTh}</span>
                  <span className="chip warn">{t('anLeftN', { n: num(d.onHand) })}</span>
                </div>
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section className="stack">
        <h3>{t('anCats')}</h3>
        <ul className="list">
          {a.categories.slice(0, 8).map((c) => (
            <li key={c.category ?? '-'} className="an">
              <div className="anrow">
                <span>{c.category ?? t('none')}</span>
                <b>{num(c.cases)}</b>
              </div>
              <Bar pct={(c.cases / maxCat) * 100} />
              <div className="muted small">{t('anShare', { p: Math.round((c.cases / Math.max(1, a.totalSold)) * 100) })}</div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
