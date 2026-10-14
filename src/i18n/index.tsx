import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { en } from './en';
import { th, type Dict } from './th';

export type Lang = 'th' | 'en';
export type Key = keyof Dict;

const dicts: Record<Lang, Dict> = { th, en };

interface I18n {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: Key, vars?: Record<string, string | number>) => string;
  date: (iso: string | null | undefined) => string;
  dateTime: (iso: string | null | undefined) => string;
  num: (n: number) => string;
}

const Ctx = createContext<I18n | null>(null);

function loadLang(): Lang {
  try {
    const v = localStorage.getItem('stock.lang');
    if (v === 'th' || v === 'en') return v;
  } catch {
    /* storage may be unavailable */
  }
  return 'th';
}

// Stored times are store wall-clock time. Format them as UTC so the device's own time zone never shifts them.
function parts(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(iso);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0)));
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(loadLang);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem('stock.lang', l);
    } catch {
      /* ignore */
    }
    document.documentElement.lang = l;
  }, []);

  const value = useMemo<I18n>(() => {
    const locale = lang === 'th' ? 'th-TH' : 'en-GB';
    const dFmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
    const dtFmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC' });
    const nFmt = new Intl.NumberFormat('en-US');
    return {
      lang,
      setLang,
      t: (key, vars) => {
        let s: string = dicts[lang][key];
        if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
        return s;
      },
      date: (iso) => {
        const d = iso ? parts(iso) : null;
        return d ? dFmt.format(d) : '—';
      },
      dateTime: (iso) => {
        const d = iso ? parts(iso) : null;
        return d ? dtFmt.format(d) : '—';
      },
      num: (n) => nFmt.format(n),
    };
  }, [lang, setLang]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const v = useContext(Ctx);
  if (!v) throw new Error('I18nProvider missing');
  return v;
}
