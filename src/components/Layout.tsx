import type { ReactNode } from 'react';
import { useI18n, type Key } from '../i18n';
import { useRepo } from '../lib/repo/context';
import { navigate } from '../lib/router';
import { alertCount, useInsights } from '../features/alerts/useInsights';

interface Tab {
  path: string;
  label: Key;
  icon: string;
  owner?: boolean;
}

const TABS: Tab[] = [
  { path: '/', label: 'navHome', icon: '⌂' },
  { path: '/products', label: 'navProducts', icon: '☰' },
  { path: '/alerts', label: 'navAlerts', icon: '⚠' },
  { path: '/order', label: 'navOrder', icon: '✎', owner: true },
  { path: '/upload', label: 'navUpload', icon: '⇪', owner: true },
];

export function Layout({ route, children }: { route: string; children: ReactNode }) {
  const { t, lang, setLang } = useI18n();
  const repo = useRepo();
  const user = repo.user!;
  const badge = alertCount(useInsights());
  const tabs = TABS.filter((x) => !x.owner || user.role === 'owner');
  const active = (p: string) => (p === '/' ? route === '/' : route.startsWith(p));

  return (
    <div className="shell">
      <header className="top">
        <div>
          <strong>{t('appName')}</strong>
          <span className="muted small"> · {t('shop')}</span>
        </div>
        <div className="row gap">
          <span className="chip">{user.role === 'owner' ? t('roleOwner') : t('roleStaff')}</span>
          <button className="ghost" onClick={() => setLang(lang === 'th' ? 'en' : 'th')} aria-label="language">
            {t('lang')}
          </button>
          <button className="ghost" onClick={() => repo.logout()}>
            {t('logout')}
          </button>
        </div>
      </header>
      <main className="page">{children}</main>
      <nav className="bottom">
        {tabs.map((x) => (
          <a key={x.path} href={`#${x.path}`} className={active(x.path) ? 'on' : ''} onClick={() => navigate(x.path)}>
            <span className="ic">
              {x.icon}
              {x.path === '/alerts' && badge > 0 && <b className="badge">{badge > 99 ? '99+' : badge}</b>}
            </span>
            {t(x.label)}
          </a>
        ))}
      </nav>
    </div>
  );
}
