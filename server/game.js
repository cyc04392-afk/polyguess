// 한 방의 권위 있는 상태 머신. 네트워크와 분리되어 있고 send 콜백만 쓴다.
import {
  DEFAULT_SETTINGS, applySettings, canStart, roundCount, stepType, stepAssignee, selfBuildFor, timeFor,
  DYNAMIC_COUNTDOWN, SCORE, isExactMatch, PROMPT_SUGGESTIONS, pickRandom, LIMITS, PRESETS,
} from '../shared/rules.js';
import { sanitizeScene, emptyScene } from '../shared/scene.js';
import { sanitizeTimelapse } from '../shared/timelapse.js';

const GRACE_MS = 3000;          // 제한시간 뒤 클라이언트 자동 제출을 기다리는 여유
const GUESS_RESULT_MS = 6000;   // 다같이 맞추기: 정답 공개 후 다음 작품까지
const AVATAR_SHAPES = 10, AVATAR_COLORS = 12;

export class Lobby {
  constructor(code, { send, onEmpty }) {
    this.code = code;
    this.sendTo = send;
    this.onEmpty = onEmpty;
    this.players = new Map();          // id → { id, name, avatar, score, connected }
    this.order = [];                   // 입장 순서
    this.hostId = null;
    this.settings = { ...DEFAULT_SETTINGS };
    this.game = null;
  }

  // ── 연결 ──
  join(id, name, avatar) {
    name = String(name || '').trim().slice(0, LIMITS.nameMax) || `플레이어${this.order.length + 1}`;
    avatar = sanitizeAvatar(avatar);
    const ghost = [...this.players.values()].find(p => !p.connected && p.name === name);
    if (ghost) {
      const oldId = ghost.id;
      this.players.delete(oldId);
      ghost.id = id; ghost.connected = true;
      this.players.set(id, ghost);
      this.order = this.order.map(x => (x === oldId ? id : x));
      if (this.game) {
        const g = this.game;
        g.seats = g.seats.map(x => (x === oldId ? id : x));
        for (const a of g.albums) { if (a.author === oldId) a.author = id; for (const s of a.steps) if (s.by === oldId) s.by = id; }
        if (g.guess) { if (g.guess.solved.has(oldId)) { g.guess.solved.delete(oldId); g.guess.solved.add(id); } for (const gu of g.guess.guesses) if (gu.from === oldId) gu.from = id; }
      }
      if (this.hostId === oldId || !this.hostId) this.hostId = id;
    } else {
      if (this.game) return { ok: false, reason: '게임이 진행 중이에요. 이번 판이 끝나면 들어올 수 있어요.' };
      if (this.order.length >= this.settings.maxPlayers) return { ok: false, reason: '방이 가득 찼어요.' };
      if ([...this.players.values()].some(p => p.name === name)) name = `${name}${Math.floor(Math.random() * 90 + 10)}`;
      this.players.set(id, { id, name, avatar, score: 0, likes: 0, connected: true });
      this.order.push(id);
      if (!this.hostId) this.hostId = id;
    }
    this.sendTo(id, { type: 'welcome', you: id, name: this.players.get(id).name, lobby: this.code });
    this.broadcastLobby();
    if (this.game) this.resendState(id);
    return { ok: true };
  }

  // voluntary=true 면 본인이 '나가기'를 누른 것: 먼저 알려 주고, 대기실이면 바로 빼고, 게임 중이면 자리만 비운다(같은 이름으로 돌아올 수 있게)
  leave(id, voluntary = false) {
    const p = this.players.get(id);
    if (!p) return;
    if (voluntary) this.sendTo(id, { type: 'left', lobby: this.code });
    if (this.game) p.connected = false;
    else { this.players.delete(id); this.order = this.order.filter(x => x !== id); }
    if (this.hostId === id) this.hostId = this.order.find(x => this.players.get(x)?.connected) || null;
    if (![...this.players.values()].some(q => q.connected)) { this.clearTimers(); this.onEmpty(this.code); return; }
    this.broadcastLobby();
    if (this.game?.phase === 'step') this.checkStepDone();
  }

  // ── 송신 ──
  broadcast(msg, except = null) { for (const p of this.players.values()) if (p.connected && p.id !== except) this.sendTo(p.id, msg); }
  name(id) { return this.players.get(id)?.name ?? '?'; }
  publicPlayers() { return this.order.map(id => { const p = this.players.get(id); return { id, name: p.name, avatar: p.avatar, score: p.score, likes: p.likes || 0, connected: p.connected }; }); }
  broadcastLobby() {
    this.broadcast({ type: 'lobby', lobby: this.code, hostId: this.hostId, players: this.publicPlayers(), settings: this.settings, inGame: !!this.game, canStart: canStart(this.settings, this.order.length) });
  }

  // ── 메시지 ──
  handle(id, msg) {
    const p = this.players.get(id);
    if (!p) return;
    const isHost = id === this.hostId, g = this.game;
    switch (msg.type) {
      case 'settings': if (isHost && !g && msg.settings && typeof msg.settings === 'object') { this.settings = applySettings(this.settings, msg.settings); this.broadcastLobby(); } break;
      case 'preset': { const pr = PRESETS.find(x => x.key === msg.key); if (isHost && !g && pr) { this.settings = applySettings(this.settings, pr.settings); this.broadcastLobby(); } break; }
      case 'avatar': if (!g) { p.avatar = sanitizeAvatar(msg.avatar); this.broadcastLobby(); } break;
      case 'start': if (isHost && !g) this.startGame(); break;
      case 'chat': {
        const text = String(msg.text || '').trim().slice(0, 200);
        if (!text) break;
        if (g?.phase === 'guess' && g.guess && !g.guess.done && this.isGuesser(id)) return this.makeGuess(id, text);
        this.broadcast({ type: 'chat', from: id, name: p.name, text });
        break;
      }
      case 'submit': if (g?.phase === 'step') this.submit(id, msg); break;
      case 'unsubmit': if (g?.phase === 'step') this.unsubmit(id); break;
      case 'albumGo': if (g?.phase === 'album' && isHost) this.albumGo(msg.album, msg.step); break;
      case 'albumNext': if (g?.phase === 'album' && isHost) this.albumNext(1); break;
      case 'albumPrev': if (g?.phase === 'album' && isHost) this.albumNext(-1); break;
      case 'judge': if (g?.phase === 'guess') this.judge(id, msg.guessId); break;
      case 'skipRound': if (g?.phase === 'guess') this.skipRound(id); break;
      case 'toLobby': if (isHost && g && (g.phase === 'album' || g.phase === 'score')) this.endGame(); break;
      case 'abort': if (isHost && g) this.endGame(); break;
      case 'like': if (g && (g.phase === 'album' || g.phase === 'guess' || g.phase === 'score')) this.toggleLike(id, msg.album, msg.step); break;
    }
  }

  // ── 진행 ──
  startGame() {
    const seats = this.order.filter(id => this.players.get(id).connected);
    const check = canStart(this.settings, seats.length);
    if (!check.ok) return this.sendTo(this.hostId, { type: 'error', text: check.reason });
    for (const p of this.players.values()) p.score = 0;
    this.game = {
      settings: { ...this.settings, selfBuild: selfBuildFor(this.settings, seats.length) }, seats, rounds: roundCount(this.settings, seats.length), round: -1,
      phase: null, deadline: 0, timer: null, shortened: false,
      albums: seats.map(author => ({ author, steps: [] })),
      album: { index: 0, step: 0 }, guess: null,
    };
    this.broadcastLobby();
    this.startRound();
  }

  endGame() {
    this.clearTimers();
    this.game = null;
    for (const [id, p] of [...this.players]) if (!p.connected) { this.players.delete(id); this.order = this.order.filter(x => x !== id); }
    if (!this.hostId || !this.players.get(this.hostId)) this.hostId = this.order[0] || null;
    this.broadcast({ type: 'phase', phase: 'lobby', serverNow: Date.now() });
    this.broadcastLobby();
  }

  clearTimers() { const g = this.game; if (!g) return; clearTimeout(g.timer); if (g.guess) clearTimeout(g.guess.timer); }

  startRound() {
    const g = this.game;
    clearTimeout(g.timer);
    g.round++;
    g.phase = 'step';
    g.shortened = false;
    const type = stepType(g.round);
    g.albums.forEach((a, i) => { a.steps[g.round] = { type, by: stepAssignee(g.settings, g.seats, i, g.round), done: false, text: null, scene: null, likes: [] }; });
    const secs = timeFor(g.settings, type);
    g.deadline = Date.now() + secs * 1000;
    g.timer = setTimeout(() => this.finishRound(), secs * 1000 + GRACE_MS);
    for (const id of g.seats) this.resendState(id);
  }

  currentStepOf(id) {
    const g = this.game;
    const i = g.albums.findIndex(a => a.steps[g.round]?.by === id);
    return i < 0 ? null : { album: i, step: g.albums[i].steps[g.round] };
  }

  // 플레이어 한 명에게 현재 상태를 보낸다(재접속에도 사용)
  resendState(id) {
    const g = this.game;
    if (!g || !this.players.get(id)?.connected) return;
    const base = { type: 'phase', phase: g.phase, serverNow: Date.now(), settings: g.settings, seats: g.seats, players: this.publicPlayers(), round: g.round, rounds: g.rounds };
    if (g.phase === 'step') {
      const cur = this.currentStepOf(id);
      if (!cur) return this.sendTo(id, { ...base, deadline: g.deadline, task: null });
      const prev = g.round > 0 ? g.albums[cur.album].steps[g.round - 1] : null;
      return this.sendTo(id, {
        ...base, deadline: g.deadline, done: cur.step.done,
        task: {
          type: cur.step.type, album: cur.album, author: g.albums[cur.album].author,
          prev: prev ? { type: prev.type, by: prev.by, text: prev.text, scene: prev.scene } : null,
          mine: { text: cur.step.text, scene: cur.step.scene },
          suggestions: cur.step.type === 'write' && g.round === 0 ? shuffle(PROMPT_SUGGESTIONS).slice(0, 4) : [],
          progress: this.progress(),
        },
      });
    }
    if (g.phase === 'album') return this.sendTo(id, { ...base, task: { albums: g.albums.map(publicAlbum), index: g.album.index, step: g.album.step, timelapse: g.albums[g.album.index]?.steps[g.album.step]?.timelapse || null } });
    if (g.phase === 'guess') return this.sendTo(id, { ...base, task: { albums: g.albums.map(a => ({ author: a.author, steps: a.steps.map(s => ({ type: s.type, by: s.by, scene: s.scene, text: null, likes: s.likes || [] })) })), round: this.guessRoundMsg(id) } });
    if (g.phase === 'score') return this.sendTo(id, { ...base, task: { albums: g.albums.map(publicAlbum) } });
  }

  progress() { const g = this.game; return g.albums.map(a => a.steps[g.round]).filter(s => s?.done).map(s => s.by); }

  submit(id, msg) {
    const g = this.game, cur = this.currentStepOf(id);
    if (!cur) return;
    const s = cur.step;
    if (s.type === 'write') s.text = String(msg.text || '').trim().slice(0, LIMITS.textMax) || null;
    else { s.scene = sanitizeScene(msg.scene); s.timelapse = msg.timelapse ? sanitizeTimelapse(msg.timelapse, s.scene) : null; }
    s.done = true;
    this.sendTo(id, { type: 'submitted', done: true });
    this.broadcast({ type: 'progress', done: this.progress() });
    this.checkStepDone();
  }

  unsubmit(id) {
    const g = this.game, cur = this.currentStepOf(id);
    if (!cur || g.shortened && g.deadline - Date.now() < 3000) return;
    cur.step.done = false;
    this.sendTo(id, { type: 'submitted', done: false });
    this.broadcast({ type: 'progress', done: this.progress() });
  }

  checkStepDone() {
    const g = this.game;
    if (!g || g.phase !== 'step') return;
    const active = g.seats.filter(id => this.players.get(id)?.connected);
    const waiting = active.filter(id => !this.currentStepOf(id)?.step.done);
    if (waiting.length === 0) return this.finishRound();
    // 다이나믹: 과반이 끝내면 카운트다운
    if (g.settings.dynamic && !g.shortened && waiting.length < active.length / 2) {
      g.shortened = true;
      g.deadline = Math.min(g.deadline, Date.now() + DYNAMIC_COUNTDOWN * 1000);
      clearTimeout(g.timer);
      g.timer = setTimeout(() => this.finishRound(), g.deadline - Date.now() + GRACE_MS);
      this.broadcast({ type: 'deadline', deadline: g.deadline, serverNow: Date.now(), reason: 'majority' });
    }
  }

  finishRound() {
    const g = this.game;
    if (!g || g.phase !== 'step') return;
    clearTimeout(g.timer);
    for (const a of g.albums) {
      const s = a.steps[g.round];
      if (s.type === 'write' && !s.text) s.text = g.round === 0 ? pickRandom(PROMPT_SUGGESTIONS) : '(시간이 다 됐어요…)';
      if (s.type === 'build' && !s.scene) s.scene = emptyScene();
      s.done = true;
    }
    if (g.round + 1 < g.rounds) return this.startRound();
    if (g.settings.mode === 'guess') return this.startGuessPhase();
    this.startAlbum();
  }

  // ── 앨범 공개(릴레이 모드) ──
  startAlbum() {
    const g = this.game;
    g.phase = 'album'; g.deadline = 0;
    g.album = { index: 0, step: 0 };
    for (const id of g.seats) this.resendState(id);
  }
  // 따봉: 3D 작품(만들기 단계)에만, 본인 작품은 안 되고, 다시 누르면 취소. 만든 사람의 누적 따봉도 같이 바뀐다.
  toggleLike(id, album, step) {
    const g = this.game;
    const a = g.albums[Math.round(Number(album))];
    const s = a?.steps[Math.round(Number(step))];
    if (!s || s.type !== 'build' || s.by === id) return;
    const owner = this.players.get(s.by);
    const i = s.likes.indexOf(id);
    if (i >= 0) { s.likes.splice(i, 1); if (owner) owner.likes = Math.max(0, (owner.likes || 0) - 1); }
    else { s.likes.push(id); if (owner) owner.likes = (owner.likes || 0) + 1; }
    this.broadcast({ type: 'likes', album: g.albums.indexOf(a), step: a.steps.indexOf(s), likes: s.likes.slice(), players: this.publicPlayers() });
  }
  albumGo(album, step) {
    const g = this.game;
    album = Math.max(0, Math.min(g.albums.length - 1, Math.round(Number(album) || 0)));
    step = Math.max(0, Math.min(g.albums[album].steps.length - 1, Math.round(Number(step) || 0)));
    g.album = { index: album, step };
    this.broadcast({ type: 'album', index: album, step, serverNow: Date.now(), timelapse: g.albums[album].steps[step].timelapse || null });
  }
  albumNext(dir) {
    const g = this.game;
    let { index, step } = g.album;
    const len = a => g.albums[a].steps.length;
    if (dir > 0) { if (step + 1 < len(index)) step++; else if (index + 1 < g.albums.length) { index++; step = 0; } else return this.albumGo(index, step); }
    else { if (step > 0) step--; else if (index > 0) { index--; step = len(index) - 1; } }
    this.albumGo(index, step);
  }

  // ── 다같이 맞추기 ──
  startGuessPhase() {
    const g = this.game;
    g.phase = 'guess';
    g.guess = { idx: -1, guesses: [], nextId: 1, solved: new Set(), done: false, timer: null, results: {}, startAt: 0, deadline: 0 };
    this.nextGuessRound(true);
  }
  guessAlbum() { return this.game.albums[this.game.guess.idx]; }
  isGuesser(id, a = this.guessAlbum()) { return !!a && id !== a.author && id !== a.steps[1].by; }
  guessRoundMsg(forId) {
    const g = this.game, G = g.guess, a = g.albums[G.idx];
    if (!a) return null;
    const res = G.results[G.idx] || null;
    return {
      idx: G.idx, total: g.albums.length, author: a.author, builder: a.steps[1].by, guessers: g.seats.filter(id => this.isGuesser(id, a)), deadline: G.deadline, done: G.done,
      timelapse: G.done ? a.steps[1].timelapse || null : null,
      answer: G.done || forId === a.author ? a.steps[0].text : null,
      guesses: G.guesses.map(gu => this.guessFor(gu, forId, a)),
      solved: [...G.solved], result: res,
    };
  }
  guessFor(gu, forId, a) {
    const canSee = this.game.guess.done || forId === a.author || forId === a.steps[1].by || forId === gu.from || gu.correct;
    return { id: gu.id, from: gu.from, name: this.name(gu.from), text: canSee ? gu.text : null, correct: !!gu.correct, exact: forId === a.author ? gu.exact : undefined };
  }
  nextGuessRound(first = false) {
    const g = this.game, G = g.guess;
    clearTimeout(G.timer);
    G.idx++;
    if (G.idx >= g.albums.length) { g.phase = 'score'; g.deadline = 0; for (const id of g.seats) this.resendState(id); return; }
    const secs = timeFor(g.settings, 'guess');
    G.guesses = []; G.solved = new Set(); G.done = false;
    G.startAt = Date.now() + 1500; G.deadline = G.startAt + secs * 1000;
    G.timer = setTimeout(() => this.finishGuessRound(), secs * 1000 + 1500);
    if (first) for (const id of g.seats) this.resendState(id);
    else for (const id of g.seats) this.sendTo(id, { type: 'guessRound', serverNow: Date.now(), round: this.guessRoundMsg(id) });
  }
  makeGuess(id, text) {
    const g = this.game, G = g.guess, a = this.guessAlbum();
    if (G.done || G.solved.has(id)) return;
    const gu = { id: G.nextId++, from: id, text: text.slice(0, LIMITS.textMax), exact: isExactMatch(text, a.steps[0].text), correct: false };
    G.guesses.push(gu);
    if (gu.exact) return this.markCorrect(gu);
    for (const pid of g.seats) this.sendTo(pid, { type: 'guessMade', guess: this.guessFor(gu, pid, a) });
  }
  markCorrect(gu) {
    const g = this.game, G = g.guess, a = this.guessAlbum();
    if (gu.correct || G.solved.has(gu.from)) return;
    gu.correct = true;
    const first = G.solved.size === 0;
    G.solved.add(gu.from);
    this.players.get(gu.from).score += first ? SCORE.firstGuess : SCORE.laterGuess;
    if (first) { this.players.get(a.steps[1].by).score += SCORE.builder; if (a.author !== a.steps[1].by) this.players.get(a.author).score += SCORE.author; }
    for (const pid of g.seats) this.sendTo(pid, { type: 'guessMade', guess: this.guessFor(gu, pid, a), players: this.publicPlayers(), solved: [...G.solved] });
    const guessers = g.seats.filter(id => this.isGuesser(id) && this.players.get(id)?.connected);
    if (guessers.every(id => G.solved.has(id))) this.finishGuessRound();
  }
  judge(id, guessId) {
    const g = this.game, G = g.guess, a = this.guessAlbum();
    const authorAway = !this.players.get(a.author)?.connected;
    if (G.done || !(id === a.author || (authorAway && id === this.hostId))) return;
    const gu = G.guesses.find(x => x.id === guessId);
    if (gu) this.markCorrect(gu);
  }
  skipRound(id) { const a = this.guessAlbum(); if (a && (id === a.author || id === this.hostId)) this.finishGuessRound(); }
  finishGuessRound() {
    const g = this.game, G = g.guess, a = this.guessAlbum();
    if (!g || G.done) return;
    clearTimeout(G.timer);
    G.done = true;
    G.results[G.idx] = { solved: [...G.solved], answer: a.steps[0].text };
    this.broadcast({ type: 'guessResult', idx: G.idx, answer: a.steps[0].text, solved: [...G.solved], guesses: G.guesses.map(gu => ({ id: gu.id, from: gu.from, name: this.name(gu.from), text: gu.text, correct: gu.correct })), players: this.publicPlayers() });
    G.timer = setTimeout(() => this.nextGuessRound(), GUESS_RESULT_MS);
  }
}

function publicAlbum(a) { return { author: a.author, steps: a.steps.map(s => ({ type: s.type, by: s.by, text: s.text, scene: s.scene, likes: s.likes || [] })) }; }
function sanitizeAvatar(a) {
  const n = (v, m) => { const x = Math.round(Number(v)); return Number.isFinite(x) ? ((x % m) + m) % m : Math.floor(Math.random() * m); };
  return { shape: n(a?.shape, AVATAR_SHAPES), color: n(a?.color, AVATAR_COLORS) };
}
function shuffle(arr) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
