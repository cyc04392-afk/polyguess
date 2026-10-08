// 정적 파일 + WebSocket 서버. 게임 규칙은 server/game.js, shared/rules.js에 있다.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Lobby } from './server/game.js';
import { MSG } from './shared/rules.js';
import { t, normalizeLang, DEFAULT_LANG } from './shared/i18n.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8080;

const STATIC = [
  ['/shared/', path.join(__dirname, 'shared')],
  ['/vendor/three/', path.join(__dirname, 'node_modules', 'three')],
  ['/', path.join(__dirname, 'public')],
];
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
};
const PUBLIC = path.join(__dirname, 'public');

// 광고: public/ads.config.js 의 client(ca-pub-…)를 읽어 index.html 머리글에 애드센스 코드를 넣고 /ads.txt 를 만들어 준다(애드센스 사이트 확인용).
function adsClient() {
  try { const m = /client:\s*['"]([^'"]*)['"]/.exec(fs.readFileSync(path.join(PUBLIC, 'ads.config.js'), 'utf8')); return m && /^ca-pub-\d{6,}$/.test(m[1]) ? m[1] : ''; } catch { return ''; }
}
function withAdsHead(html, client) {
  if (!client || html.includes('adsbygoogle.js')) return html;
  const tags = `<meta name="google-adsense-account" content="${client}">\n<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${client}" crossorigin="anonymous"></script>\n`;
  return html.includes('</head>') ? html.replace('</head>', tags + '</head>') : tags + html;
}

function serveStatic(req, res) {
  let url;
  try { url = decodeURIComponent(req.url.split('?')[0]); } catch { res.writeHead(400); return res.end(); }
  if (url === '/') url = '/index.html';
  if (url === '/api/health') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ok: true, lobbies: lobbies.size })); }
  if (url === '/api/log') {
    if (req.method === 'POST') {
      let body = ''; req.on('data', c => { body += c; if (body.length > 8192) req.destroy(); });
      req.on('end', () => { recordClientLog(req, body); res.writeHead(204); res.end(); });
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-cache' }); return res.end(JSON.stringify(CLIENT_LOG));
  }
  if (url === '/debug') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' }); return res.end(debugPage()); }
  if (url === '/api/version') { res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-cache' }); return res.end(JSON.stringify(VERSION)); }
  if (url === '/ads.txt' && !fs.existsSync(path.join(PUBLIC, 'ads.txt'))) {
    const client = adsClient();
    if (!client) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': MIME['.txt'], 'cache-control': 'no-cache' });
    return res.end(`google.com, ${client.replace(/^ca-/, '')}, DIRECT, f08c47fec0942fa0\n`);
  }
  for (const [prefix, root] of STATIC) {
    if (!url.startsWith(prefix)) continue;
    const file = path.resolve(root, url.slice(prefix.length));
    if (file !== root && !file.startsWith(root + path.sep)) break;
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
      res.end(file === path.join(PUBLIC, 'index.html') ? withAdsHead(data.toString('utf8'), adsClient()) : data);
    });
    return;
  }
  res.writeHead(404); res.end('not found');
}

// 어떤 버전이 떠 있는지 밖에서 확인할 수 있게(/api/version). Render 는 RENDER_GIT_COMMIT 환경 변수를 넣어 준다.
const VERSION = (() => {
  let version = '0';
  try { version = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version || '0'; } catch { /* 없으면 0 */ }
  return { version, commit: (process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || '').slice(0, 12) || null, started: new Date().toISOString(), node: process.version, langs: ['ko', 'en', 'ja', 'zh', 'fr', 'de'] };
})();

// 진단 기록: 브라우저의 부팅 감시(index.html 인라인 스크립트)가 오류·페이지 이탈을 보고하면 최근 60개를 메모리에 두고 /debug 에서 보여 준다.
// 개인정보는 남기지 않는다(IP 는 같은 사람인지 구분용 짧은 해시만).
const CLIENT_LOG = [];
const LOG_MAX = 60;
const ipTag = req => crypto.createHash('sha1').update(String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim()).digest('hex').slice(0, 6);
const clip = (v, n) => String(v ?? '').slice(0, n);
function recordClientLog(req, raw) {
  let j; try { j = JSON.parse(raw); } catch { return; }
  if (!j || typeof j !== 'object') return;
  const e = { at: new Date().toISOString(), who: ipTag(req), ev: clip(j.ev, 20), msg: clip(j.msg, 400), url: clip(j.url, 200), ua: clip(j.ua, 220), t: Number(j.t) || 0, lang: clip(j.lang, 60), size: `${Number(j.w) || 0}x${Number(j.h) || 0}`, vis: clip(j.vis, 12), booted: !!j.booted, extra: clip(j.extra, 200) };
  CLIENT_LOG.push(e); if (CLIENT_LOG.length > LOG_MAX) CLIENT_LOG.shift();
  console.log('[client]', JSON.stringify(e));
}
const escHtml = v => String(v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function debugPage() {
  const rows = [...CLIENT_LOG].reverse().map(e => `<tr><td>${escHtml(e.at.slice(11, 19))}</td><td>${escHtml(e.who)}</td><td><b>${escHtml(e.ev)}</b></td><td>${escHtml(e.msg)}${e.extra ? ' · ' + escHtml(e.extra) : ''}</td><td>${e.t}ms · ${escHtml(e.vis)} · ${e.booted ? 'booted' : '-'}</td><td>${escHtml(e.url)}</td><td>${escHtml(e.size)} · ${escHtml(e.lang)}</td><td>${escHtml(e.ua)}</td></tr>`).join('');
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta http-equiv="refresh" content="10"><title>폴리게스 진단</title>
<style>body{font:14px/1.5 -apple-system,'Segoe UI','Noto Sans KR',sans-serif;margin:16px;color:#222}table{border-collapse:collapse;width:100%;font-size:12px}td,th{border:1px solid #ccc;padding:4px 6px;vertical-align:top;word-break:break-all}th{background:#eee}h1{font-size:20px;margin:0 0 6px}p{margin:4px 0}</style></head>
<body><h1>폴리게스 진단 (Diagnostics)</h1>
<p>버전 ${escHtml(VERSION.version)} · 커밋 ${escHtml(VERSION.commit || '?')} · 서버 시작 ${escHtml(VERSION.started)} · Node ${escHtml(VERSION.node)} · 지금 ${new Date().toISOString()} · 방 ${lobbies.size}개</p>
<p>아래는 최근에 접속한 브라우저들이 보낸 보고예요(최대 ${LOG_MAX}개, 최신이 위). <b>load</b>=페이지 열림, <b>booted</b>=코드 끝까지 실행됨, <b>error</b>=오류, <b>pagehide</b>=페이지를 떠남, <b>hidden</b>=탭이 가려짐. 10초마다 새로 고쳐요.</p>
<table><tr><th>시각</th><th>사람</th><th>이벤트</th><th>내용</th><th>경과·상태</th><th>주소</th><th>화면·언어</th><th>브라우저</th></tr>${rows || '<tr><td colspan="8">아직 보고가 없어요</td></tr>'}</table></body></html>`;
}

const server = http.createServer(serveStatic);
const wss = new WebSocketServer({ server, maxPayload: 24 * 1024 * 1024 });

const lobbies = new Map();   // code → Lobby
const clients = new Map();   // playerId → ws

const send = (ws, msg) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg)); };

function newCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code;
  do { code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join(''); } while (lobbies.has(code));
  return code;
}

function makeLobby(code) {
  const lobby = new Lobby(code, {
    send: (id, msg) => { const ws = clients.get(id); if (ws) send(ws, msg); },
    onEmpty: c => { lobbies.delete(c); console.log(`[lobby ${c}] closed`); },
  });
  lobbies.set(code, lobby);
  console.log(`[lobby ${code}] created`);
  return lobby;
}


wss.on('connection', ws => {
  const id = 'p' + crypto.randomUUID().replace(/-/g, '').slice(0, 10);
  clients.set(id, ws);
  ws.lobby = null;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', raw => {
    try { onMessage(raw); } catch (e) { console.error(`[ws ${id}] 메시지 처리 중 오류 (서버는 계속 돕니다)`, e); }
  });
  function onMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg.type !== 'string') return;
    if (msg.type === 'join') {
      if (ws.lobby) return;
      let code = String(msg.lobby || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
      let lobby;
      if (!code) { code = newCode(); lobby = makeLobby(code); }
      else {
        lobby = lobbies.get(code);
        if (!lobby) return send(ws, { type: 'error', key: MSG.noRoom, params: { code }, text: t(MSG.noRoom, { code }, normalizeLang(msg.lang) || DEFAULT_LANG) });
      }
      const r = lobby.join(id, msg.name, msg.avatar, msg.lang);
      if (!r.ok) {
        send(ws, { type: 'error', key: r.key, params: r.params || null, text: r.text });
        if (lobby.order.length === 0) lobbies.delete(code);
        return;
      }
      ws.lobby = lobby;
      console.log(`[lobby ${code}] ${lobby.name(id)} joined (${lobby.order.length})`);
      return;
    }
    if (msg.type === 'leave') { if (ws.lobby) { ws.lobby.leave(id, true); ws.lobby = null; } return; }
    if (ws.lobby) ws.lobby.handle(id, msg);
  }

  ws.on('close', () => {
    clients.delete(id);
    if (ws.lobby) ws.lobby.leave(id);
  });
  ws.on('error', () => {});
});

// 유휴 연결 정리(프록시 뒤에서 끊긴 소켓 감지)
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 25000).unref();

// 예상 못 한 오류로 서버가 통째로 죽어 모든 방이 사라지는 일을 막는다(기록만 남기고 계속 돈다)
process.on('uncaughtException', e => console.error('[server] 잡히지 않은 오류', e));
process.on('unhandledRejection', e => console.error('[server] 처리되지 않은 비동기 오류', e));

server.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`폴리게스 prototype: ${url}`);
  console.log('이 창을 닫으면 게임 서버가 꺼집니다. 친구는 같은 와이파이에서 http://<내 IP>:' + PORT + ' 로 들어오면 됩니다.');
  // 시작 스크립트(시작.bat / 시작.command)에서 켜면 브라우저를 자동으로 연다
  if (process.env.OPEN_BROWSER) {
    const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
    exec(cmd, () => {});
  }
});
