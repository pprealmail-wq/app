import { useState } from 'react';
import { useI18n } from '../../i18n';
import { useRepo } from '../../lib/repo/context';

export function Login() {
  const { t, lang, setLang } = useI18n();
  const repo = useRepo();
  const users = repo.loginUsers();
  const [userId, setUserId] = useState(users[0]?.id ?? '');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<'pin' | 'other' | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await repo.login(userId, pin);
      location.hash = '/';
    } catch (e) {
      setError(e instanceof Error && e.message === 'wrong_pin' ? 'pin' : 'other');
      setPin('');
    }
    setBusy(false);
  };

  return (
    <div className="login">
      <button className="ghost lang" onClick={() => setLang(lang === 'th' ? 'en' : 'th')}>
        {t('lang')}
      </button>
      <img src="icons/icon-192.png" width={72} height={72} alt="" className="logo" />
      <h1>{t('appName')}</h1>
      <p className="muted">{t('shop')}</p>
      <form onSubmit={submit} className="card stack">
        <h2>{t('loginTitle')}</h2>
        <div className="seg" role="radiogroup" aria-label={t('chooseUser')}>
          {users.map((u) => (
            <button type="button" key={u.id} role="radio" aria-checked={userId === u.id} className={userId === u.id ? 'on' : ''} onClick={() => setUserId(u.id)}>
              {u.role === 'owner' ? t('roleOwner') : t('roleStaff')}
            </button>
          ))}
        </div>
        <label>
          {repo.isRemote ? t('password') : t('pin')}
          {repo.isRemote ? (
            <input type="password" autoComplete="current-password" maxLength={72} value={pin} onChange={(e) => setPin(e.target.value)} />
          ) : (
            <input type="password" inputMode="numeric" autoComplete="off" maxLength={8} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
          )}
        </label>
        {error && <p className="notice warn" role="alert">{error === 'pin' ? (repo.isRemote ? t('wrongPassword') : t('wrongPin')) : t('err_other')}</p>}
        <button className="primary" disabled={busy || pin.length < (repo.isRemote ? 6 : 4)}>
          {t('loginButton')}
        </button>
        <p className="muted small">{repo.isRemote ? t('remoteHint') : t('demoHint')}</p>
      </form>
    </div>
  );
}
