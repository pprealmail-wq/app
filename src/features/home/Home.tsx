import { useI18n } from '../../i18n';
import { useRepo } from '../../lib/repo/context';

export function Home() {
  const { t, date, dateTime, num } = useI18n();
  const repo = useRepo();
  const s = repo.stats();
  const owner = repo.user!.role === 'owner';

  return (
    <div className="stack">
      {s.products === 0 ? (
        <div className="card center stack">
          <h2>{t('noData')}</h2>
          <p className="muted">{owner ? t('noDataOwner') : t('noDataStaff')}</p>
          {owner && (
            <a className="btn primary" href="#/upload">
              {t('goUpload')}
            </a>
          )}
        </div>
      ) : (
        <>
          <div className="card">
            <p className="muted small">{t('dataUntil')}</p>
            <p className="big">{date(s.latestDataDate)}</p>
            <p className="muted small">
              {t('lastUpload')}: {dateTime(s.lastImportAt)}
            </p>
          </div>
          <div className="grid2">
            <div className="card stat">
              <span className="big">{num(s.products)}</span>
              <span className="muted small">{t('statProducts')}</span>
            </div>
            <div className="card stat">
              <span className="big">{num(s.receipts)}</span>
              <span className="muted small">{t('statReceipts')}</span>
            </div>
          </div>
          {owner && (s.heldOpen > 0 || s.mismatchOpen > 0) && (
            <div className="card">
              <h3>{t('needsAttention')}</h3>
              {s.heldOpen > 0 && <p>{t('heldCount', { n: s.heldOpen })}</p>}
              {s.mismatchOpen > 0 && <p>{t('mismatchCount', { n: s.mismatchOpen })}</p>}
              <a className="btn" href="#/upload">
                {t('goUpload')}
              </a>
            </div>
          )}
          <a className="btn primary" href="#/products">
            {t('goProducts')}
          </a>
        </>
      )}
      {owner && (
        <a className="btn ghost-btn" href="#/checks">
          {t('systemCheck')}
        </a>
      )}
    </div>
  );
}
