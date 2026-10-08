// 광고 자리의 클래스 이름이 광고 차단 목록(EasyList 등)에 걸리지 않는지 검사한다.
// 2026-10-08: body 에 'side-ads' 를 붙였더니 차단 확장 프로그램이 body 를 통째로 숨겨 화면 전체가 하얘졌다. 다시는 그러지 않도록.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
// 차단 목록에 흔한 낱말: 클래스 토큰이 이런 낱말로 시작·끝나면 위험(.ad, .ads, .ad-right, .side-ads, .banner, .sponsor …)
const RISKY = /(^|-|_)(ad|ads|adv|advert|advertisement|banner|sponsor|sponsored|promo)(-|_|$)/i;

test('ads.js 가 붙이는 클래스는 광고 차단 목록에 걸릴 이름이 아니다', () => {
  const src = read('public/js/ads.js');
  const tokens = new Set();
  for (const m of src.matchAll(/classList\.add\(([^)]*)\)/g)) for (const t of m[1].matchAll(/'([^']+)'/g)) tokens.add(t[1]);
  for (const m of src.matchAll(/className = `([^`]*)`/g)) for (const t of m[1].split(/\s+/)) tokens.add(t.replace(/\$\{[^}]*\}/g, 'x'));
  assert.ok(tokens.size >= 3, '클래스를 찾지 못함');
  for (const t of tokens) {
    if (t === 'adsbygoogle') continue; // 애드센스가 요구하는 이름(차단되면 광고만 안 나오고 화면은 멀쩡함)
    assert.ok(!RISKY.test(t), `차단 목록에 걸릴 수 있는 클래스: ${t}`);
  }
});

test('style.css 와 HTML 의 body·#app 에 광고 낱말이 든 클래스가 없다', () => {
  const css = read('public/style.css').replace(/\/\*[\s\S]*?\*\//g, ''); // 주석은 빼고 본다
  for (const m of css.matchAll(/body\.([\w-]+)|#app\.([\w-]+)/g)) {
    const t = m[1] || m[2];
    assert.ok(!RISKY.test(t), `body/#app 에 위험한 클래스: ${t}`);
  }
  assert.ok(!/\.(ad|ads|side-ads|ad-left|ad-right|ad-bottom)\b/.test(css), 'style.css 에 옛 광고 클래스(.ad·.side-ads …)가 남아 있음');
  for (const f of ['public/index.html', 'public/demo.html', 'public/about.html']) {
    const html = read(f);
    for (const m of html.matchAll(/<(?:body|main)[^>]*class="([^"]*)"/g)) for (const t of m[1].split(/\s+/)) assert.ok(!RISKY.test(t), `${f} body/main 에 위험한 클래스: ${t}`);
  }
});
