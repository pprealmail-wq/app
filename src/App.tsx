import { useEffect, useState } from 'react';
import { I18nProvider, useI18n } from './i18n';
import { IdbKV } from './lib/repo/kv';
import { LocalRepo } from './lib/repo/localRepo';
import { RepoProvider, useRepo } from './lib/repo/context';
import { useRoute } from './lib/router';
import { Layout } from './components/Layout';
import { Login } from './features/auth/Login';
import { Home } from './features/home/Home';
import { Products } from './features/products/Products';
import { ProductDetail } from './features/products/ProductDetail';
import { Upload } from './features/pos-import/Upload';
import { Checks } from './features/checks/Checks';
import { Alerts } from './features/alerts/Alerts';
import { ToOrder } from './features/order/ToOrder';
import { Settings } from './features/settings/Settings';

const SESSION_KEY = 'stock.session';

function Routes() {
  const repo = useRepo();
  const { t } = useI18n();
  const route = useRoute();
  const user = repo.user;
  if (!user) return <Login />;

  const ownerOnly = (node: JSX.Element) => (user.role === 'owner' ? node : <p className="notice warn">{t('forbidden')}</p>);
  let page: JSX.Element;
  if (route.startsWith('/products/')) page = <ProductDetail id={decodeURIComponent(route.slice('/products/'.length))} />;
  else if (route === '/products') page = <Products />;
  else if (route === '/alerts') page = <Alerts />;
  else if (route === '/order') page = ownerOnly(<ToOrder />);
  else if (route === '/settings') page = ownerOnly(<Settings />);
  else if (route === '/upload') page = ownerOnly(<Upload />);
  else if (route === '/checks') page = ownerOnly(<Checks />);
  else page = <Home />;
  return <Layout route={route}>{page}</Layout>;
}

function Boot() {
  const { t } = useI18n();
  const [repo, setRepo] = useState<LocalRepo | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const r = new LocalRepo(new IdbKV());
    r.init()
      .then(() => {
        let saved: string | null = null;
        try {
          saved = localStorage.getItem(SESSION_KEY);
        } catch {
          /* ignore */
        }
        r.restore(saved);
        r.subscribe(() => {
          try {
            if (r.user) localStorage.setItem(SESSION_KEY, r.user.id);
            else localStorage.removeItem(SESSION_KEY);
          } catch {
            /* ignore */
          }
        });
        setRepo(r);
      })
      .catch(() => setFailed(true));
  }, []);

  if (failed) return <p className="notice warn">{t('err_other')}</p>;
  if (!repo) return <p className="center muted">{t('loading')}</p>;
  return (
    <RepoProvider repo={repo}>
      <Routes />
    </RepoProvider>
  );
}

export function App() {
  return (
    <I18nProvider>
      <Boot />
    </I18nProvider>
  );
}
