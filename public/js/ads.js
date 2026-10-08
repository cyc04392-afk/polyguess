import { t } from '../shared/i18n.js';
// 광고 자리: 모든 화면의 양옆에 세로 배너(1100px 이상), 폰·태블릿처럼 좁은 화면에서는 아래 가로 배너. 설정은 ads.config.js.
// 클래스 이름 주의: 광고 차단 확장 프로그램은 EasyList 같은 목록의 클래스(.ad, .ad-right, .side-ads …)를 가진 요소를 통째로 숨긴다.
// 예전에 body 에 'side-ads' 를 붙였더니 차단기가 body 자체를 숨겨 화면 전체가 하얘졌다(2026-10-08). 그래서 자리 이름은 'rail', body 는 'with-rails' 로 둔다(test/layout-classes.test.js 가 검사).
// 서버가 index.html 머리글에 애드센스 스크립트를 넣어 주지만, 정적 호스팅일 때를 위해 없으면 여기서도 넣는다.
const cfg = () => window.POLYGUESS_ADS || null;

export function mountAds() {
  const c = cfg();
  if (!c?.enabled) return;
  const ready = c.client && c.provider === 'adsense';
  if (!ready && !c.showPlaceholders) return;
  if (ready && !document.querySelector('script[src*="adsbygoogle.js"]')) {
    const s = document.createElement('script');
    s.async = true; s.crossOrigin = 'anonymous';
    s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(c.client)}`;
    document.head.appendChild(s);
  }
  const make = (pos, slot) => {
    const box = document.createElement('aside');
    box.className = `rail rail-${pos}`;
    box.setAttribute('aria-label', t('광고'));
    if (ready && slot) {
      const ins = document.createElement('ins');
      ins.className = 'adsbygoogle';
      ins.style.display = 'block'; ins.style.width = '100%'; ins.style.height = '100%';
      ins.dataset.adClient = c.client; ins.dataset.adSlot = slot;
      box.appendChild(ins);
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } else {
      box.classList.add('rail-empty');
      box.innerHTML = t('<span>광고 자리</span><small>ads.config.js 에 광고 번호를 적으면 여기에 광고가 나와요</small>');
    }
    return box;
  };
  document.body.append(make('left', c.slots?.left), make('right', c.slots?.right));
  document.body.classList.add('with-rails');
  document.querySelector('#app')?.append(make('bottom', c.slots?.bottom));
  // 안전장치: 그래도 어떤 차단기가 body 나 #app 까지 숨기면 광고 자리를 포기하고 화면을 되살린다
  requestAnimationFrame(() => {
    const app = document.querySelector('#app');
    if (getComputedStyle(document.body).display !== 'none' && !(app && getComputedStyle(app).display === 'none')) return;
    document.body.classList.remove('with-rails');
    for (const r of document.querySelectorAll('.rail')) r.remove();
    window.__beacon_send?.('adblock', 'body/#app hidden after mounting rails → rails removed');
  });
}
