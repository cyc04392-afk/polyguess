// 광고 자리: 넓은 화면에서는 양옆 세로 배너, 좁은 화면에서는 아래 가로 배너. 설정은 ads.config.js.
const cfg = () => window.POLYGUESS_ADS || null;

export function mountAds() {
  const c = cfg();
  if (!c?.enabled) return;
  const ready = c.client && c.provider === 'adsense';
  if (!ready && !c.showPlaceholders) return;
  if (ready) {
    const s = document.createElement('script');
    s.async = true; s.crossOrigin = 'anonymous';
    s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(c.client)}`;
    document.head.appendChild(s);
  }
  const make = (pos, slot) => {
    const box = document.createElement('aside');
    box.className = `ad ad-${pos}`;
    box.setAttribute('aria-label', '광고');
    if (ready && slot) {
      const ins = document.createElement('ins');
      ins.className = 'adsbygoogle';
      ins.style.display = 'block'; ins.style.width = '100%'; ins.style.height = '100%';
      ins.dataset.adClient = c.client; ins.dataset.adSlot = slot;
      box.appendChild(ins);
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } else {
      box.classList.add('placeholder');
      box.innerHTML = '<span>광고 자리</span><small>ads.config.js 에 광고 번호를 적으면 여기에 광고가 나와요</small>';
    }
    return box;
  };
  document.body.append(make('left', c.slots?.left), make('right', c.slots?.right));
  document.querySelector('#app')?.append(make('bottom', c.slots?.bottom));
}
