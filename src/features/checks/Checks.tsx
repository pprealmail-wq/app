import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '../../i18n';
import { runChecks } from '../../lib/rules/runChecks';

type Result = Awaited<ReturnType<typeof runChecks>>;

export function Checks() {
  const { t } = useI18n();
  const [res, setRes] = useState<Result | null>(null);
  const run = useCallback(() => {
    setRes(null);
    runChecks().then(setRes);
  }, []);
  useEffect(run, [run]);
  const ok = res?.filter((r) => r.pass).length ?? 0;
  return (
    <div className="stack">
      <a href="#/">← {t('back')}</a>
      <h2>{t('checksTitle')}</h2>
      <p className="muted">{t('checksHelp')}</p>
      {res ? (
        <>
          <p className={`notice ${ok === res.length ? 'ok' : 'warn'}`}>{t('checksSummary', { n: ok, total: res.length })}</p>
          <ul className="list">
            {res.map((r) => (
              <li key={r.id} className="chk">
                <span className={r.pass ? 'tag ok' : 'tag bad'}>{r.pass ? t('pass') : t('fail')}</span>
                <div>
                  <div>
                    {r.id}. {r.name}
                  </div>
                  <div className="muted small">{r.detail}</div>
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="muted">{t('loading')}</p>
      )}
      <button onClick={run}>{t('checksRun')}</button>
    </div>
  );
}
