// 정적 파일 + WebSocket 서버. 게임 규칙은 server/game.js, shared/rules.js에 있다.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Lobby } from './server/game.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8080;

const STATIC = [
  ['/shared/', path.join(__dirname, 'shared')],
  ['/vendor/three/', path.join(__dirname, 'node_modules', 'three')],
  ['/', path.join(__dirname, 'public')],
];
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.md': 'text/markdown; charset=utf-8',
};

function serveStatic(req, res) {
  let url;
  try { url = decodeURIComponent(req.url.split('?')[0]); } catch { res.writeHead(400); return res.end(); }
  if (url === '/') url = '/index.html';
  if (url === '/api/health') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ok: true, lobbies: lobbies.size })); }
  for (const [prefix, root] of STATIC) {
    if (!url.startsWith(prefix)) continue;
    const file = path.resolve(root, url.slice(prefix.length));
    if (file !== root && !file.startsWith(root + path.sep)) break;
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
      res.end(data);
    });
    return;
  }
  res.writeHead(404); res.end('not found');
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
        if (!lobby) return send(ws, { type: 'error', text: `방 ${code}을(를) 찾을 수 없습니다.` });
      }
      const r = lobby.join(id, msg.name, msg.avatar);
      if (!r.ok) {
        send(ws, { type: 'error', text: r.reason });
        if (lobby.order.length === 0) lobbies.delete(code);
        return;
      }
      ws.lobby = lobby;
      console.log(`[lobby ${code}] ${lobby.name(id)} joined (${lobby.order.length})`);
      return;
    }
    if (msg.type === 'leave') { if (ws.lobby) { ws.lobby.leave(id, true); ws.lobby = null; } return; }
    if (ws.lobby) ws.lobby.handle(id, msg);
  });

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
