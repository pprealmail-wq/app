import { useMemo, useRef, useState } from 'react';
import { useI18n, type Key } from '../../i18n';
import { FileReadError, readTable } from '../../lib/csv/readTable';
import { ForbiddenError } from '../../lib/repo/localRepo';
import { useRepo } from '../../lib/repo/context';
import { detectKind, normalizePosTable, parseProductListTable, type PosParse, type ProductListParse } from '../../lib/rules';
import { Review } from './Review';

type Loaded =
  | { kind: 'pos'; filename: string; parse: PosParse }
  | { kind: 'productList'; filename: string; parse: ProductListParse };

type Done = { text: string };

export function Upload() {
  const { t, date, num } = useI18n();
  const repo = useRepo();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<'reading' | 'applying' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [useOpening, setUseOpening] = useState(true);
  const [done, setDone] = useState<Done | null>(null);

  const reset = () => {
    setLoaded(null);
    setDone(null);
    setError(null);
    if (input.current) input.current.value = '';
  };

  const describe = (e: unknown): string => {
    if (e instanceof FileReadError) return t(`err_${e.code}` as Key);
    if (e instanceof ForbiddenError) return t('err_forbidden');
    return t('err_other');
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    reset();
    setBusy('reading');
    try {
      const table = await readTable(await file.arrayBuffer());
      const { kind, missing } = detectKind(table.headers);
      if (kind === 'pos') setLoaded({ kind, filename: file.name, parse: normalizePosTable(table) });
      else if (kind === 'productList') setLoaded({ kind, filename: file.name, parse: parseProductListTable(table) });
      else setError(`${t('unknownFile')} — ${t('missingHeaders', { list: missing.join(', ') })}`);
    } catch (e) {
      setError(describe(e));
    }
    setBusy(null);
  };

  const plan = useMemo(() => (loaded?.kind === 'pos' ? repo.previewPos(loaded.parse, { useOpeningFromPos: useOpening }) : null), [repo, repo.version, loaded, useOpening]);
  const listPlan = useMemo(() => (loaded?.kind === 'productList' ? repo.previewProductList(loaded.parse) : null), [repo, repo.version, loaded]);

  const apply = async () => {
    if (!loaded) return;
    setBusy('applying');
    setError(null);
    try {
      if (loaded.kind === 'pos') {
        const r = await repo.applyPos(loaded.parse, { useOpeningFromPos: useOpening }, loaded.filename);
        setDone({ text: t('doneSummary', { r: r.record.receiptsNew, p: r.record.productsCreated, h: r.record.heldLines }) });
      } else {
        const r = await repo.applyProductList(loaded.parse, loaded.filename);
        setDone({ text: `${t('listCreate')} ${r.plan.toCreate.length} · ${t('listUpdate')} ${r.plan.toUpdate.length}` });
      }
      setLoaded(null);
    } catch (e) {
      setError(describe(e));
    }
    setBusy(null);
  };

  const imports = repo.imports();

  return (
    <div className="stack">
      <h2>{t('uploadTitle')}</h2>
      <p className="muted">{t('uploadHelp')}</p>

      <label className="drop">
        <input ref={input} type="file" accept=".xls,.xlsx,.csv,.txt,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" onChange={(e) => void onFile(e.target.files?.[0])} />
        <span className="btn primary">{t('chooseFile')}</span>
      </label>

      {busy === 'reading' && <p className="muted">{t('reading')}</p>}
      {error && <p className="notice warn" role="alert">{error}</p>}

      {done && (
        <div className="card stack" role="status">
          <h3>✓ {t('doneTitle')}</h3>
          <p>{done.text}</p>
          <div className="row gap">
            <a className="btn primary" href="#/products">{t('viewProducts')}</a>
            <button onClick={reset}>{t('chooseFile')}</button>
          </div>
        </div>
      )}

      {loaded?.kind === 'pos' && plan && (
        <div className="card stack">
          <h3>{t('previewTitle')}</h3>
          <p className="muted small">{loaded.filename}</p>
          <dl className="facts">
            <dt>{t('dateRange')}</dt>
            <dd>{plan.dateFrom ? `${date(plan.dateFrom)} – ${date(plan.dateTo)}` : t('none')}</dd>
            <dt>{t('newReceipts')}</dt>
            <dd>
              {num(plan.receiptsNew.length)}
              <span className="muted small"> ({t('ofWhichSales', { n: plan.receiptsNew.filter((r) => r.kind === 'sale').length })}, {t('ofWhichReceive', { n: plan.receiptsNew.filter((r) => r.kind === 'receive').length })})</span>
            </dd>
            <dt>{t('skipped')}</dt>
            <dd>{num(plan.receiptsSkipped)}</dd>
            <dt>{t('newProducts')}</dt>
            <dd>{num(plan.newProducts.length)}</dd>
            <dt>{t('heldLines')}</dt>
            <dd>{num(plan.held.length)}</dd>
            <dt>{t('mismatches')}</dt>
            <dd>{num(plan.mismatches.length)}</dd>
          </dl>
          {plan.newProducts.length > 0 && (
            <label className="check">
              <input type="checkbox" checked={useOpening} onChange={(e) => setUseOpening(e.target.checked)} />
              <span>
                {t('openingOption')}
                <small className="muted block">{t('openingHint')}</small>
              </span>
            </label>
          )}
          {plan.receiptsNew.length === 0 && plan.newProducts.length === 0 && <p className="notice">{t('nothingNew')}</p>}
          <div className="row gap">
            <button className="primary" disabled={busy === 'applying' || (plan.receiptsNew.length === 0 && plan.newProducts.length === 0)} onClick={() => void apply()}>
              {busy === 'applying' ? t('applying') : t('apply')}
            </button>
            <button onClick={reset}>{t('cancel')}</button>
          </div>
        </div>
      )}

      {loaded?.kind === 'productList' && listPlan && (
        <div className="card stack">
          <h3>
            {t('previewTitle')} · {t('kindList')}
          </h3>
          <p className="muted small">{loaded.filename}</p>
          <dl className="facts">
            <dt>{t('listCreate')}</dt>
            <dd>{num(listPlan.toCreate.length)}</dd>
            <dt>{t('listUpdate')}</dt>
            <dd>{num(listPlan.toUpdate.length)}</dd>
            <dt>{t('listUnchanged')}</dt>
            <dd>{num(listPlan.unchanged)}</dd>
            <dt>{t('listInvalid')}</dt>
            <dd>{num(listPlan.invalid.length)}</dd>
          </dl>
          <p className="muted small">{t('listNote')}</p>
          <div className="row gap">
            <button className="primary" disabled={busy === 'applying'} onClick={() => void apply()}>
              {busy === 'applying' ? t('applying') : t('apply')}
            </button>
            <button onClick={reset}>{t('cancel')}</button>
          </div>
        </div>
      )}

      <Review />

      <h3>{t('historyTitle')}</h3>
      {imports.length === 0 && <p className="muted">{t('noHistory')}</p>}
      <ul className="list">
        {imports.map((i) => (
          <li key={i.id} className="mv">
            <div>
              <div className="name">{i.filename}</div>
              <div className="muted small">
                {i.kind === 'pos' ? t('histPos') : t('histList')} · {t('doneSummary', { r: i.receiptsNew, p: i.productsCreated, h: i.heldLines })}
              </div>
            </div>
          </li>
        ))}
      </ul>

      <details className="card">
        <summary>{t('demoTitle')}</summary>
        <button
          className="danger"
          onClick={() => {
            if (!confirm(repo.isRemote ? t('clearConfirmShared') : t('clearConfirm'))) return;
            repo
              .clearData()
              .then(() => {
                reset();
                setDone({ text: t('clearedOk') });
              })
              .catch((e) => setError(describe(e)));
          }}
        >
          {t('clearData')}
        </button>
      </details>
    </div>
  );
}
