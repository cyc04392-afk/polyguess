// 다국어 — 키는 한국어 원문, 번역이 없으면 한국어가 그대로 나온다. 순수 JS라 서버(방 언어·오류 메시지)와 브라우저가 같이 쓴다.
//   t('도형을 하나 고른 뒤 쓸 수 있어요')                 → 현재 언어
//   t('{n}명', { n: 3 })                                   → 자리 채우기. 번역문에서 {n|player|players} 로 단수/복수를 고를 수 있다
//   t(key, params, 'en')                                   → 서버처럼 언어를 직접 줄 때
import en from './lang/en.js';
import ja from './lang/ja.js';
import zh from './lang/zh.js';
import fr from './lang/fr.js';
import de from './lang/de.js';

export const LANGS = [
  { code: 'ko', name: '한국어' },
  { code: 'en', name: 'English' },
  { code: 'ja', name: '日本語' },
  { code: 'zh', name: '中文' },
  { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' },
];
export const LANG_CODES = LANGS.map(l => l.code);
export const DEFAULT_LANG = 'ko';
export const DICTS = { en, ja, zh, fr, de };
export const LANG_STORE_KEY = 'polyguess.lang';
// 일본어·중국어는 글꼴을 따로 받는다(한글 글꼴에 글자가 없어서)
export const LANG_FONTS = { ja: 'Noto Sans JP', zh: 'Noto Sans SC' };

// 'en-US' → 'en', 'zh-TW' → 'zh', 모르는 말 → null
export function normalizeLang(code) {
  const c = String(code || '').trim().toLowerCase().replace('_', '-');
  if (!c) return null;
  const base = c.split('-')[0];
  return LANG_CODES.includes(base) ? base : null;
}
// 후보 중 처음으로 아는 언어, 없으면 한국어
export function pickLang(candidates) {
  for (const c of candidates || []) { const n = normalizeLang(c); if (n) return n; }
  return DEFAULT_LANG;
}
// 브라우저 순서: 주소의 ?lang= → 저장된 선택 → 브라우저 언어 → 한국어
export function detectLang({ search = '', stored = null, navigatorLangs = [] } = {}) {
  let q = null;
  try { q = new URLSearchParams(search).get('lang'); } catch { q = null; }
  return pickLang([q, stored, ...navigatorLangs]);
}

let current = DEFAULT_LANG;
export function getLang() { return current; }
export function setLang(code) {
  current = normalizeLang(code) || DEFAULT_LANG;
  if (typeof document !== 'undefined' && document.documentElement) document.documentElement.lang = current;
  return current;
}

// '{n}' 자리 채우기, '{n|한 개|여러 개}' 는 n 이 1이면 앞, 아니면 뒤
export function format(s, params) {
  if (!params) return s;
  return String(s).replace(/\{(\w+)(?:\|([^|}]*)\|([^}]*))?\}/g, (m, k, one, many) => {
    const v = params[k];
    if (one !== undefined) return Number(v) === 1 ? one : many;
    return v === undefined || v === null ? m : String(v);
  });
}
export function hasKey(key, lang) {
  const d = DICTS[lang];
  return !!d && Object.prototype.hasOwnProperty.call(d, key);
}
export function t(key, params, lang = current) {
  const s = hasKey(key, lang) ? DICTS[lang][key] : key;
  return format(s, params);
}

// 정적 HTML: data-i18n="키"(글), data-i18n-html="키"(태그 포함), data-i18n-title / -placeholder / -aria / -content(meta)
export function applyDom(root = document) {
  const each = (sel, fn) => root.querySelectorAll(sel).forEach(fn);
  each('[data-i18n]', el => { el.textContent = t(el.dataset.i18n); });
  each('[data-i18n-html]', el => { el.innerHTML = t(el.dataset.i18nHtml); });
  each('[data-i18n-title]', el => { el.title = t(el.dataset.i18nTitle); });
  each('[data-i18n-placeholder]', el => { el.placeholder = t(el.dataset.i18nPlaceholder); });
  each('[data-i18n-aria]', el => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
  each('[data-i18n-content]', el => { el.setAttribute('content', t(el.dataset.i18nContent)); });
}

// 브라우저에서는 불러오자마자 언어를 정한다(다른 모듈이 import 할 때 이미 맞는 언어가 되도록)
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  let stored = null;
  try { stored = localStorage.getItem(LANG_STORE_KEY); } catch { stored = null; }
  const lang = detectLang({ search: location.search, stored, navigatorLangs: navigator.languages || [navigator.language] });
  setLang(lang);
  let q = null;
  try { q = new URLSearchParams(location.search).get('lang'); } catch { q = null; }
  if (q && normalizeLang(q)) { try { localStorage.setItem(LANG_STORE_KEY, lang); } catch { /* 비공개 창 등 */ } }
  const font = LANG_FONTS[lang];
  if (font && !document.querySelector(`link[data-lang-font="${lang}"]`)) {
    const link = document.createElement('link');
    link.rel = 'stylesheet'; link.dataset.langFont = lang;
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(font).replace(/%20/g, '+')}:wght@400;500;700&display=swap`;
    document.head.append(link);
  }
}
