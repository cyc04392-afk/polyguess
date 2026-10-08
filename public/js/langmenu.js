// 언어 바꾸기 버튼(지구본 아이콘) — 고르면 저장하고 페이지를 다시 연다(모든 글자가 모듈을 불러올 때 정해지므로)
import { LANGS, getLang, LANG_STORE_KEY, t } from '../shared/i18n.js';
import { ICONS } from './icons.js';

export function chooseLang(code) {
  try { localStorage.setItem(LANG_STORE_KEY, code); } catch { /* 저장 못 해도 주소로 전달 */ }
  const u = new URL(location.href);
  u.searchParams.delete('lang');
  if (u.href === location.href) location.reload();
  else location.replace(u.href);
}

export function mountLangMenu(container) {
  const wrap = document.createElement('div');
  wrap.className = 'lang-menu';
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'lang-btn'; btn.id = 'lang-btn';
  btn.title = t('언어 바꾸기'); btn.setAttribute('aria-label', t('언어 바꾸기')); btn.setAttribute('aria-haspopup', 'true');
  btn.innerHTML = ICONS.globe + `<span class="lang-code">${getLang().toUpperCase()}</span>`;
  const list = document.createElement('div');
  list.className = 'lang-list hidden'; list.setAttribute('role', 'menu');
  for (const l of LANGS) {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = l.name; b.lang = l.code; b.dataset.lang = l.code; b.setAttribute('role', 'menuitem');
    if (l.code === getLang()) b.classList.add('on');
    b.onclick = () => chooseLang(l.code);
    list.append(b);
  }
  btn.onclick = e => { e.stopPropagation(); list.classList.toggle('hidden'); };
  document.addEventListener('click', () => list.classList.add('hidden'));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') list.classList.add('hidden'); });
  wrap.append(btn, list);
  container.append(wrap);
  return wrap;
}
