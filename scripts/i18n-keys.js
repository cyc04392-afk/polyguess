// 소스에서 번역 키(한글이 든 문자열 리터럴·data-i18n 속성)를 모은다. 테스트와 번역 작업 도구가 같이 쓴다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HANGUL = /[가-힣]/;
export const JS_FILES = [
  ...fs.readdirSync(path.join(ROOT, 'public/js')).filter(f => f.endsWith('.js')).map(f => 'public/js/' + f),
  ...fs.readdirSync(path.join(ROOT, 'shared')).filter(f => f.endsWith('.js') && f !== 'i18n.js').map(f => 'shared/' + f),   // i18n.js 의 언어 이름(한국어 등)은 번역하지 않는다
  'server/game.js',
];
export const HTML_FILES = ['public/index.html', 'public/demo.html', 'public/about.html'];

// 정규식 리터럴(안에 따옴표가 있을 수 있다)을 공백으로 지운다
function stripRegexLiterals(src) {
  return src.replace(/(?<=[(,=:!&|?\s])\/(?:\\.|\[(?:\\.|[^\]\n])*\]|[^/\\\n[\s])+\/[a-z]*(?=[),.;\s])/g, m => ' '.repeat(m.length));
}

// JS 를 훑어 문자열 리터럴을 모은다. 템플릿의 ${} 안은 재귀로, 템플릿 글자 부분에 한글이 있으면 leftovers 에 넣는다
export function scanJS(src, file) {
  src = stripRegexLiterals(src);
  const literals = [], leftovers = [];
  let i = 0;
  const n = src.length;
  function readString(q) { // i 는 여는 따옴표 위치
    let j = i + 1, out = '';
    while (j < n && src[j] !== q) {
      if (src[j] === '\\') { out += JSON.parse(`"\\${src[j + 1] === "'" ? "'" : src[j + 1]}"`.replace('"\\\'"', '"\'"')); j += 2; continue; }
      if (src[j] === '\n') break;
      out += src[j++];
    }
    i = j + 1;
    return out;
  }
  function readTemplate() { // i 는 여는 백틱
    let j = i + 1, text = '';
    while (j < n && src[j] !== '`') {
      if (src[j] === '\\') { text += src[j + 1]; j += 2; continue; }
      if (src[j] === '$' && src[j + 1] === '{') {
        // 식 끝(짝 맞는 }) 찾기 — 안의 문자열/템플릿은 재귀 스캔
        let depth = 1, k = j + 2, exprStart = k;
        while (k < n && depth > 0) {
          const c = src[k];
          if (c === "'" || c === '"') { const save = i; i = k; readString(c); k = i; i = save; continue; }
          if (c === '`') { const save = i; i = k; readTemplate(); k = i; i = save; continue; }
          if (c === '{') depth++;
          else if (c === '}') depth--;
          k++;
        }
        const expr = src.slice(exprStart, k - 1);
        const sub = scanJS(expr, file);
        literals.push(...sub.literals); leftovers.push(...sub.leftovers);
        j = k; continue;
      }
      text += src[j++];
    }
    i = j + 1;
    if (HANGUL.test(text)) leftovers.push({ file, text: text.trim() });
  }
  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
    if (c === "'" || c === '"') { const s = readString(c); if (HANGUL.test(s)) literals.push(s); continue; }
    if (c === '`') { readTemplate(); continue; }
    i++;
  }
  return { literals, leftovers };
}

// HTML: data-i18n*="키" 속성(작은따옴표도) 을 키로, 태그 밖 글자에 한글이 있는데 번역 속성이 없는 요소는 leftovers
export function scanHTML(src, file) {
  const keys = [], leftovers = [];
  let body = src.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
  for (const m of body.matchAll(/data-i18n(?:-[a-z]+)?=(?:"([^"]*)"|'([^']*)')/g)) keys.push(m[1] ?? m[2]);
  // data-i18n-html 요소의 속은 통째로 번역되므로 안의 태그·글자는 보지 않는다
  body = body.replace(/<([a-z0-9]+)([^>]*data-i18n-html=[^>]*)>[\s\S]*?<\/\1>/g, '<$1$2></$1>');
  // 번역 속성 없는 한글: 여는 태그마다 다음 글자 덩어리를 본다
  for (const m of body.matchAll(/<([a-z0-9]+)([^>]*)>([^<]*)/g)) {
    const [, , attrs, text] = m;
    if (HANGUL.test(text) && !/data-i18n(?:-html)?=/.test(attrs)) leftovers.push({ file, text: text.trim() });
    for (const a of attrs.matchAll(/\s(title|placeholder|aria-label|alt|content)="([^"]*)"/g)) {
      if (HANGUL.test(a[2]) && !attrs.includes(`data-i18n-${{ title: 'title', placeholder: 'placeholder', 'aria-label': 'aria', alt: 'alt', content: 'content' }[a[1]]}=`)) leftovers.push({ file, text: `${a[1]}=${a[2]}` });
    }
  }
  return { keys, leftovers };
}

export function collectKeys() {
  const keys = new Map(); // key → [files]
  const leftovers = [];
  const add = (k, f) => { if (!keys.has(k)) keys.set(k, []); if (!keys.get(k).includes(f)) keys.get(k).push(f); };
  for (const f of HTML_FILES) { const r = scanHTML(fs.readFileSync(path.join(ROOT, f), 'utf8'), f); r.keys.forEach(k => add(k, f)); leftovers.push(...r.leftovers); }
  for (const f of JS_FILES) { const r = scanJS(fs.readFileSync(path.join(ROOT, f), 'utf8'), f); r.literals.forEach(k => add(k, f)); leftovers.push(...r.leftovers); }
  return { keys, leftovers };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { keys, leftovers } = collectKeys();
  const byFile = new Map();
  for (const [k, files] of keys) { const f = files[0]; if (!byFile.has(f)) byFile.set(f, []); byFile.get(f).push(k); }
  for (const [f, ks] of byFile) { console.log(`\n// ===== ${f} (${ks.length})`); for (const k of ks) console.log(JSON.stringify(k)); }
  console.log(`\n// TOTAL ${keys.size} keys`);
  if (leftovers.length) { console.log('\n// LEFTOVERS (한글인데 번역 틀 밖):'); for (const l of leftovers) console.log(` ${l.file}: ${l.text}`); }
}
