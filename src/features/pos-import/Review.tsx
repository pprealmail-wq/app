import { useI18n, type Key } from '../../i18n';
import { useRepo } from '../../lib/repo/context';

const MAX = 20;

export function Review() {
  const { t, num } = useI18n();
  const repo = useRepo();
  const held = repo.heldOpen();
  const mism = repo.mismatchesOpen();
  if (held.length === 0 && mism.length === 0) return null;

  return (
    <div className="stack">
      <h3>{t('reviewTitle')}</h3>
      {mism.length > 0 && (
        <div className="card stack">
          <h4>{t('mismatchTitle')}</h4>
          <ul className="list">
            {mism.slice(0, MAX).map((m) => (
              <li key={m.id} className="rev">
                <div>
                  <div className="name">{m.nameTh}</div>
                  <div className="muted small">
                    {m.itemCode} · {t('appBefore')} {num(m.appBefore)} · {t('posOpening')} {num(m.posOpening)}
                  </div>
                </div>
                <div className="row gap">
                  <button className="primary sm" onClick={() => void repo.acceptMismatch(m.id)}>{t('acceptPos')}</button>
                  <button className="sm" onClick={() => void repo.ignoreMismatch(m.id)}>{t('ignore')}</button>
                </div>
              </li>
            ))}
          </ul>
          {mism.length > MAX && <p className="muted small">{t('more', { n: mism.length - MAX })}</p>}
        </div>
      )}
      {held.length > 0 && (
        <div className="card stack">
          <h4>{t('heldTitle')}</h4>
          <ul className="list">
            {held.slice(0, MAX).map((h) => (
              <li key={h.id} className="rev">
                <div>
                  <div className="name">{h.nameTh || h.itemCode || t('none')}</div>
                  <div className="muted small">
                    {t('receiptWord')} {h.receiptNo || t('none')} · {h.qty} · {t(`held_${h.reason}` as Key)}
                  </div>
                </div>
                <button className="sm" onClick={() => void repo.dismissHeld(h.id)}>{t('dismiss')}</button>
              </li>
            ))}
          </ul>
          {held.length > MAX && <p className="muted small">{t('more', { n: held.length - MAX })}</p>}
        </div>
      )}
    </div>
  );
}
