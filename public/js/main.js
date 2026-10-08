// 폴리게스 클라이언트: 입장 → 방 → (글 쓰기 ↔ 3D 만들기) → 앨범 / 다같이 맞추기 → 점수
import { Net } from './net.js';
import { Viewer } from './viewer.js';
import { mountEditor, resetEditor, setLocked, disposeEditor, getEditor, shotName } from './editorui.js';
import { avatarSVG, randomAvatar } from './avatar.js';
import { PRESETS, TIME_PRESETS, LIMITS, presetFor, canStart, reasonText, MSG } from '../shared/rules.js';
import { t as tr, applyDom, getLang } from '../shared/i18n.js';
import { mountLangMenu } from './langmenu.js';
import { emptyScene } from '../shared/scene.js';
import { buildTimelapse } from '../shared/timelapse.js';
import { ICONS } from './icons.js';
import { mountAds } from './ads.js';

// ───────── 작은 도우미 ─────────
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'disabled') n.disabled = !!v;
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)));
  return n;
}
const fmtTime = s => (s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : String(s));
const store = {
  get(k, d) { try { const v = localStorage.getItem('polyguess.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('polyguess.' + k, JSON.stringify(v)); } catch { /* 비공개 창 등 */ } },
};
let toastTimer = 0;
function toast(text, ms = 2600) {
  const t = $('#toast'); t.textContent = text; t.classList.remove('hidden');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
}

// ───────── 상태 ─────────
const url = new URL(location.href);
const S = {
  me: null, name: store.get('name', ''), avatar: store.get('avatar', null) || randomAvatar(), code: (url.searchParams.get('c') || '').toUpperCase(),
  joined: false, wantJoin: false, connected: false,
  lobby: null, players: [], settings: null, hostId: null, inGame: false,
  phase: 'landing', serverOffset: 0, deadline: 0, round: 0, rounds: 0, seats: [],
  task: null, done: false, progress: [], autoSubmitted: false,
  editor: null, viewers: [],
  albums: null, album: null, albumView: null,
  gAlbums: null, guess: null, guessResult: null, feed: [], guessViewerIdx: -1,
  chat: [], lobbyTab: 'presets', howto: 0,
};
const now = () => Date.now() + S.serverOffset;
const playerOf = id => S.players.find(p => p.id === id) || { id, name: '?', avatar: { shape: 0, color: 0 }, score: 0, connected: false };
const isHost = () => S.me && S.hostId === S.me;
const avatarNode = (p, size = 36) => el('span', { class: 'av', html: avatarSVG(p.avatar, size) });

// ───────── 화면 전환 ─────────
function show(view) {
  for (const v of $$('.view')) v.classList.toggle('active', v.id === `view-${view}`);
  $('#top-mid').textContent = view === 'game' ? '' : view === 'lobby' ? tr('친구들이 다 모이면 시작을 눌러요') : '';
  document.body.dataset.view = view;
}
function showPhase(id) {
  for (const p of $$('#view-game .phase')) p.classList.toggle('hidden', p.id !== id);
}

// ───────── 네트워크 ─────────
const net = new Net(onMessage, onStatus);
function onStatus(st) {
  S.connected = st === 'open';
  const c = $('#conn');
  c.textContent = S.connected ? tr('연결됨') : tr('연결 끊김 · 다시 연결 중…');
  c.className = 'conn ' + (S.connected ? 'ok' : 'bad');
  $('#btn-join').disabled = !S.connected;
  if (S.connected) {
    if (S.joined || S.wantJoin) net.send({ type: 'join', lobby: S.code, name: S.name, avatar: S.avatar, lang: getLang() }); // 재접속(같은 이름으로 자리 되찾기)
  }
}
function onMessage(m) {
  switch (m.type) {
    case 'welcome':
      S.me = m.you; S.name = m.name; S.code = m.lobby; S.joined = true; S.wantJoin = false;
      store.set('name', S.name); store.set('avatar', S.avatar);
      history.replaceState(null, '', `?c=${m.lobby}`);
      $('#room-chip').textContent = tr('방 {code}', { code: m.lobby }); $('#room-chip').classList.remove('hidden');
      break;
    case 'lobby':
      S.lobby = m; S.players = m.players; S.settings = m.settings; S.hostId = m.hostId;
      if (!m.inGame) { if (S.inGame) teardownGame(); S.inGame = false; document.body.dataset.phase = ''; show('lobby'); }
      renderLobby();
      if (S.inGame) { renderProgress(); renderScoreboard(); }
      break;
    case 'phase': onPhase(m); break;
    case 'submitted': S.done = m.done; renderDone(); break;
    case 'progress': S.progress = m.done; renderProgress(); break;
    case 'deadline':
      S.serverOffset = m.serverNow - Date.now(); S.deadline = m.deadline;
      if (m.reason === 'majority') toast(tr('과반이 끝냈어요! 15초 안에 마무리해 주세요 ⏱️'), 4000);
      break;
    case 'album': S.serverOffset = m.serverNow - Date.now(); S.album = { index: m.index, step: m.step }; if (S.albums?.[m.index]?.steps?.[m.step]) S.albums[m.index].steps[m.step].timelapse = m.timelapse || null; renderAlbum(); break;
    case 'guessRound': S.serverOffset = m.serverNow - Date.now(); S.guess = m.round; S.guessResult = null; S.feed = []; S.deadline = m.round?.deadline || 0; renderGuess(); break;
    case 'guessMade': onGuessMade(m); break;
    case 'guessResult': S.guessResult = m; S.players = m.players; S.deadline = 0; renderGuessResult(); renderScoreboard(); renderGuessFeed(); break;
    case 'chat': onChat(m); break;
    case 'left': onLeft(); break;
    case 'likes': onLikes(m); break;
    case 'error':
      toast(m.key ? tr(m.key, m.params) : (m.text || tr('문제가 생겼어요')));
      if (!S.joined) { S.wantJoin = false; $('#btn-join').disabled = false; }
      // 끊겼다 바로 돌아왔는데 서버가 아직 내 옛 연결을 정리하지 못한 경우: 잠시 뒤 다시 자리 찾기
      else if (S.inGame && m.key === MSG.inGame) setTimeout(() => { if (S.connected) net.send({ type: 'join', lobby: S.code, name: S.name, avatar: S.avatar, lang: getLang() }); }, 3000);
      break;
  }
}

// ───────── 입장 화면 ─────────
const HOWTO = [
  { ic: '✍️', h: tr('1. 제시어 적기'), p: tr('엉뚱하고 재미있는 문장을 적어요. 짧을수록 좋아요.'), ex: tr('예) 머리에 뿔 달린 소') },
  { ic: '🧊', h: tr('2. 3D로 만들기'), p: tr('옆 사람의 글을 받아 도형을 쌓고, 합치고, 찰흙처럼 주물러 3D로 표현해요. 그림 실력은 필요 없어요!'), ex: tr('상자 + 공 + 원뿔 = ?') },
  { ic: '🤔', h: tr('3. 뭘까?'), p: tr('다음 사람은 글 없이 3D 작품만 보고 무엇인지 적어요. 그 글이 또 다음 사람에게 넘어가요.'), ex: tr('"...고양이 로봇?"') },
  { ic: '📖', h: tr('4. 앨범 공개'), p: tr('모두의 손을 거친 뒤, 글과 3D가 어떻게 변해 갔는지 처음부터 다 같이 봐요. 여기서 제일 많이 웃어요.'), ex: tr('뿔 달린 소 → 외계 소파') },
  { ic: '🙋', h: tr('다같이 맞추기 모드'), p: tr('한 사람이 만든 3D를 보고 모두가 동시에 정답을 외쳐요. 먼저 맞히면 3점, 나중에 맞히면 1점. 만든 사람도 점수를 받아요!'), ex: tr('방 설정에서 고를 수 있어요') },
];
function renderHowto() {
  const s = HOWTO[S.howto];
  $('#howto-slide').innerHTML = `<div class="big-ic">${s.ic}</div><h3>${esc(s.h)}</h3><p>${esc(s.p)}</p><div class="ex">${esc(s.ex)}</div>`;
  $('#howto-dots').replaceChildren(...HOWTO.map((_, i) => el('button', { class: i === S.howto ? 'on' : '', onclick: () => { S.howto = i; renderHowto(); }, 'aria-label': tr('{n}번째', { n: i + 1 }) })));
}
function renderAvatar() { $('#avatar-preview').innerHTML = avatarSVG(S.avatar, 96); }
function renderJoinTarget() {
  const t = $('#join-target');
  if (S.code) {
    t.classList.remove('hidden');
    t.replaceChildren(el('span', {}, tr('방 {code}에 들어가요', { code: S.code })), el('button', { title: tr('새 방 만들기로 바꾸기'), onclick: () => { S.code = ''; history.replaceState(null, '', '/'); renderJoinTarget(); } }, '✕'));
    $('#btn-join').textContent = tr('들어가기');
    $('#landing-hint').textContent = tr('친구가 보낸 초대 링크로 들어왔어요. 닉네임을 정하고 들어가기를 눌러요.');
  } else {
    t.classList.add('hidden');
    $('#btn-join').textContent = tr('시작');
    $('#landing-hint').textContent = tr('방을 새로 만들어요. 친구에게는 방에서 초대 링크를 보내 주세요.');
  }
}
function join() {
  const name = $('#name').value.trim();
  if (!name) { $('#name').focus(); return toast(tr('닉네임을 적어 주세요')); }
  S.name = name; S.wantJoin = true;
  store.set('name', name); store.set('avatar', S.avatar);
  $('#btn-join').disabled = true;
  net.send({ type: 'join', lobby: S.code, name, avatar: S.avatar, lang: getLang() });
}
// ───────── 방(로비) ─────────
function renderLobby() {
  const L = S.lobby; if (!L) return;
  const host = isHost();
  $('#player-count').textContent = `${S.players.length}/${S.settings.maxPlayers}`;
  const sel = $('#max-players');
  if (!sel.options.length) for (let i = LIMITS.minPlayers; i <= LIMITS.maxPlayers; i++) sel.append(el('option', { value: i }, tr('{n}명', { n: i })));
  if (document.activeElement !== sel) sel.value = String(S.settings.maxPlayers);
  sel.disabled = !host || L.inGame;
  $('#player-list').replaceChildren(...S.players.map(p => el('li', { class: `${p.connected ? '' : 'off'} ${p.id === S.me ? 'me' : ''}` },
    avatarNode(p), el('span', { class: 'nm' }, p.name, p.id === S.me ? ' ' + tr('(나)') : ''),
    p.id === S.hostId ? el('span', { class: 'crown', title: tr('방장') }, '👑') : null,
    likesLabel(p),
    p.score ? el('span', { class: 'sc' }, tr('{n}점', { n: p.score })) : null)));
  // 탭
  for (const b of $$('#lobby-tabs .tab')) b.classList.toggle('active', b.dataset.tab === S.lobbyTab);
  $('#tab-presets').classList.toggle('hidden', S.lobbyTab !== 'presets');
  $('#tab-custom').classList.toggle('hidden', S.lobbyTab !== 'custom');
  renderPresets(host && !L.inGame);
  renderCustom(host && !L.inGame);
  // 시작
  const check = canStart(S.settings, S.players.length);
  const begin = $('#btn-begin');
  begin.classList.toggle('hidden', !host);
  begin.disabled = !check.ok || L.inGame;
  const sameSeat = S.players.length === 1 ? ' · ' + tr('친구에게 초대 링크를 보내 주세요.') : '';
  $('#lobby-note').textContent = host ? (check.ok ? tr('{n}명이 모였어요. 시작할 준비가 됐어요!', { n: S.players.length }) : reasonText(check) + sameSeat) : tr('방장({name})이 시작하기를 기다리고 있어요', { name: playerOf(S.hostId).name });
}
function renderPresets(editable) {
  const cur = presetFor(S.settings);
  $('#tab-presets').replaceChildren(el('div', { class: 'preset-grid' }, ...PRESETS.map(p => el('button', {
    class: `preset ${cur === p.key ? 'on' : ''}`, disabled: !editable, onclick: () => net.send({ type: 'preset', key: p.key }),
  }, el('span', { class: 'ic' }, p.icon), el('span', { class: 'nm' }, tr(p.name)), el('span', { class: 'ds' }, tr(p.desc))))),
  el('p', { class: 'hint-line' }, cur ? '' : tr('지금은 커스텀 설정이에요. 커스텀 설정 탭에서 자세히 볼 수 있어요.')));
}
const secs = n => (n < 60 ? tr('{n}초', { n }) : n % 60 ? tr('{m}분 {s}초', { m: Math.floor(n / 60), s: n % 60 }) : tr('{m}분', { m: Math.floor(n / 60) }));
let customPending = false;
function renderCustom(editable) {
  const s = S.settings;
  // 숫자를 적는 중이면 덮어쓰지 않고, 칸을 벗어날 때 다시 그린다
  if (document.activeElement?.matches?.('#tab-custom input')) { customPending = true; return; }
  const send = patch => editable && net.send({ type: 'settings', settings: patch });
  const opt = (on, label, sub, onclick) => el('button', { class: `opt ${on ? 'on' : ''}`, disabled: !editable, onclick }, label, sub ? el('small', {}, sub) : null);
  const sw = (on, label, onclick, locked = false) => el('label', { class: `switch ${on ? 'on' : ''} ${locked ? 'locked' : ''}` }, el('button', { type: 'button', disabled: !editable || locked, onclick }, el('span', { class: 'knob' })), label);
  const stepper = (key, label) => el('div', { class: 'stepper' }, el('span', { class: 'sl' }, label),
    el('button', { type: 'button', disabled: !editable || s[key] <= LIMITS.timeMin, 'aria-label': tr('{label} 5초 줄이기', { label }), onclick: () => send({ [key]: s[key] - 5 }) }, '−'),
    el('input', { type: 'number', id: `time-${key}`, min: LIMITS.timeMin, max: LIMITS.timeMax, step: 5, value: s[key], disabled: !editable, 'aria-label': tr('{label} 초', { label }), onchange: e => send({ [key]: Number(e.target.value) }) }),
    el('span', { class: 'unit' }, tr('초')),
    el('button', { type: 'button', disabled: !editable || s[key] >= LIMITS.timeMax, 'aria-label': tr('{label} 5초 늘리기', { label }), onclick: () => send({ [key]: s[key] + 5 }) }, '+'));
  const timeOpts = Object.values(TIME_PRESETS).map(t => opt(s.time === t.key, tr(t.name), tr('글 {w} · 3D {b} · 맞추기 {g}', { w: secs(t.write), b: secs(t.build), g: secs(t.guess) }) + (t.dynamic ? ' · ' + tr('과반 완료 시 15초') : ''), () => send({ time: t.key })));
  const turnChoices = ['all', 2, 3, 4, 5, 6, 8];
  const rows = [
    row(tr('모드'), tr('어떻게 놀까요?'), [
      opt(s.mode === 'chain', tr('릴레이'), tr('글 → 3D → 글 → 3D… 앨범으로 공개'), () => send({ mode: 'chain' })),
      opt(s.mode === 'guess', tr('다같이 맞추기'), tr('한 사람의 3D를 모두가 맞혀요'), () => send({ mode: 'guess' })),
    ]),
    row(tr('시간'), tr('빠른 선택을 누르거나, 아래에서 초 단위로 직접 정해요'), [
      el('div', { class: 'opts' }, ...timeOpts),
      el('div', { class: 'time-grid' }, stepper('write', tr('글 쓰기')), stepper('build', tr('3D 만들기')), stepper('guess', tr('맞추기'))),
      sw(s.dynamic, tr('과반이 끝내면 15초 카운트다운으로 줄이기'), () => send({ dynamic: !s.dynamic })),
    ], 'col'),
    s.mode === 'chain' ? row(tr('턴'), tr('앨범 하나가 몇 명의 손을 거칠지'), turnChoices.map(t => opt(String(s.turns) === String(t), t === 'all' ? tr('전원') : tr('{n}턴', { n: t }), null, () => send({ turns: t })))) : null,
    s.mode === 'guess' ? row(tr('만드는 사람'), tr('제시어를 낸 사람이 직접 3D로 만들지, 다음 사람이 만들지'), (() => {
      const two = S.players.length <= 2, on = two || s.selfBuild;
      return [sw(on, on ? tr('제시어 낸 사람이 직접 만들어요') : tr('다음 사람이 만들어요 (낸 사람·만든 사람은 못 맞혀요)'), () => send({ selfBuild: !s.selfBuild }), two),
        two ? el('small', { class: 'lock-note' }, tr('2명일 때는 항상 제시어 낸 사람이 만들어요')) : null].filter(Boolean);
    })(), 'col') : null,
    s.mode === 'guess' ? row(tr('점수판'), tr('맞추기 중에 점수 순위를 옆에 보여줘요'), [sw(s.scoreboard, s.scoreboard ? tr('보임') : tr('숨김'), () => send({ scoreboard: !s.scoreboard }))]) : null,
  ];
  $('#tab-custom').replaceChildren(...rows.filter(Boolean));
  function row(label, sub, opts, cls = '') { return el('div', { class: 'setting' }, el('div', { class: 'lb' }, label, el('small', {}, sub)), el('div', { class: `opts ${cls}` }, ...opts)); }
}
function invite() {
  const link = `${location.origin}/?c=${S.code}`;
  const done = () => toast(tr('초대 링크를 복사했어요! 방 코드: {code}', { code: S.code }), 3500);
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(link).then(done, () => prompt(tr('이 링크를 친구에게 보내 주세요'), link));
  else prompt(tr('이 링크를 친구에게 보내 주세요'), link);
}
function onChat(m) {
  if (S.phase === 'guess') { S.feed.push({ kind: 'chat', from: m.from, text: m.text }); return renderGuessFeed(); }
  S.chat.push(m); if (S.chat.length > 100) S.chat.shift();
  const log = $('#chat-log');
  log.append(el('div', {}, el('b', {}, m.name + ' '), m.text));
  log.scrollTop = log.scrollHeight;
}

// 방 나가기: 서버가 left 를 보내면 처음 화면으로
function leaveRoom() { net.send({ type: 'leave' }); }
function onLeft() {
  teardownGame();
  S.joined = false; S.wantJoin = false; S.inGame = false; S.code = ''; S.lobby = null; S.players = []; S.hostId = null; S.chat = [];
  $('#chat-log').replaceChildren();
  document.body.dataset.phase = '';
  history.replaceState(null, '', '/');
  $('#room-chip').classList.add('hidden');
  $('#btn-join').disabled = !S.connected;
  renderJoinTarget();
  show('landing');
  toast(tr('방에서 나왔어요'));
}

// ───────── 따봉 ─────────
function likesOf(albums, album, step) { return albums?.[album]?.steps?.[step]?.likes || []; }
function onLikes(m) {
  for (const albums of [S.albums, S.gAlbums]) { const st = albums?.[m.album]?.steps?.[m.step]; if (st) st.likes = m.likes; }
  if (m.players) S.players = m.players;
  for (const b of $$(`[data-like="${m.album}-${m.step}"]`)) paintLike(b, m.album, m.step);
  if (S.phase === 'guess') renderScoreboard();
  if (S.phase === 'score') startScore();
  if (S.lobby && !S.inGame) renderLobby();
}
// 👍 버튼: 내 작품이면 못 누르고, 누른 사람 수가 옆에 보인다
function likeButton(albums, album, step) {
  const by = albums[album].steps[step].by;
  const b = el('button', { class: 'like-btn', 'data-like': `${album}-${step}`, disabled: by === S.me, title: by === S.me ? tr('내 작품이에요') : tr('따봉! 마음에 들면 눌러 주세요'), onclick: () => net.send({ type: 'like', album, step }) }, el('span', { class: 'ic', html: ICONS.like }), el('span', { class: 'n' }, '0'));
  paintLike(b, album, step);
  return b;
}
function paintLike(b, album, step) {
  const likes = likesOf(S.albums || S.gAlbums, album, step);
  b.querySelector('.n').textContent = String(likes.length);
  b.classList.toggle('on', likes.includes(S.me));
}
// 📷 지금 보이는 3D 를 그림 파일로 저장
function downloadDataURL(url, name) {
  // data URL 을 Blob URL 로 바꿔 내려받는다(파일 이름이 확실히 붙고, 긴 data URL 도 안전)
  let href = url, revoke = null;
  try {
    const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(url);
    if (m && m[2]) { const bin = atob(m[3]); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); href = URL.createObjectURL(new Blob([u8], { type: m[1] || 'application/octet-stream' })); revoke = href; }
  } catch { /* 그대로 data URL 사용 */ }
  const a = el('a', { href, download: name }); document.body.append(a); a.click(); a.remove();
  if (revoke) setTimeout(() => URL.revokeObjectURL(revoke), 10000);
}
function shotButton(getUrl, name) {
  return el('button', { class: 'shot-btn', title: tr('스크린샷 저장 (지금 보이는 장면을 그림 파일로)'), 'aria-label': tr('스크린샷 저장'), onclick: () => { const u = getUrl(); if (u) { downloadDataURL(u, name); toast(tr('그림 파일로 저장했어요 📷')); } } }, el('span', { class: 'ic', html: ICONS.camera }));
}
const likesLabel = p => (p.likes ? el('span', { class: 'lk', title: tr('받은 따봉') }, el('span', { class: 'ic', html: ICONS.like }), String(p.likes)) : null);

// ───────── 게임 단계 ─────────
function onPhase(m) {
  S.serverOffset = m.serverNow - Date.now();
  if (m.phase === 'lobby') { teardownGame(); S.inGame = false; document.body.dataset.phase = ''; show('lobby'); return; }
  S.inGame = true; S.settings = m.settings; S.seats = m.seats; S.players = m.players; S.round = m.round; S.rounds = m.rounds;
  show('game');
  document.body.dataset.phase = '';
  clearViewers();
  S.albumView = null;
  $('#waiting').classList.add('hidden');
  if (m.phase === 'step') startStep(m);
  else if (m.phase === 'album') startAlbum(m);
  else if (m.phase === 'guess') startGuess(m);
  else if (m.phase === 'score') startScore(m);
}
function teardownGame() {
  clearViewers();
  disposeEditor(); S.editor = null;
  S.phase = 'lobby'; S.task = null; S.deadline = 0; S.albums = null; S.gAlbums = null; S.guess = null; S.feed = [];
  $('#waiting').classList.add('hidden');
}
function clearViewers() { for (const v of S.viewers) v.dispose(); S.viewers = []; S.guessViewerIdx = -1; }
function makeViewer(container, scene, opts) {
  container.replaceChildren();
  const v = new Viewer(container, opts);
  v.load(scene || emptyScene());
  S.viewers.push(v);
  return v;
}

function startStep(m) {
  S.phase = 'step'; S.deadline = m.deadline; S.done = !!m.done; S.task = m.task; S.autoSubmitted = false; S.progress = m.task?.progress || [];
  const t = m.task;
  document.body.dataset.phase = t ? t.type : '';
  const typeName = !t ? tr('구경') : t.type === 'write' ? (S.round === 0 ? tr('제시어 적기') : tr('뭘까? 적기')) : tr('3D로 만들기');
  $('#round-info').innerHTML = `${S.round + 1} / ${S.rounds} <small>${esc(typeName)}</small>`;
  $('#timer').classList.remove('hidden');
  if (!t) showPhase('step-idle');
  else if (t.type === 'write') renderWrite();
  else renderBuild();
  renderProgress(); renderDone();
}
function renderWrite() {
  showPhase('step-write');
  const t = S.task, first = S.round === 0;
  $('#write-title').textContent = first ? tr('재미있는 제시어를 적어 주세요') : tr('이 3D는 무엇일까요?');
  $('#write-sub').textContent = first ? tr('이 글을 옆 사람이 3D로 만들어요. 엉뚱할수록 재밌어요!') : tr('{name}님이 만든 작품이에요. 드래그해서 돌려 보고, 무엇인지 적어 주세요.', { name: playerOf(t.prev?.by).name });
  const vb = $('#write-viewer');
  if (t.prev?.scene) { vb.classList.remove('hidden'); makeViewer(vb, t.prev.scene); } else { vb.classList.add('hidden'); vb.replaceChildren(); }
  const sg = $('#write-suggest');
  if (first && t.suggestions?.length) {
    sg.classList.remove('hidden');
    sg.replaceChildren(el('span', { class: 'lb' }, tr('생각이 안 나면 이런 건 어때요?')), ...t.suggestions.map(s => el('button', { type: 'button', onclick: () => { $('#write-input').value = s; $('#write-input').focus(); } }, s)));
  } else sg.classList.add('hidden');
  const inp = $('#write-input');
  inp.value = t.mine?.text || '';
  inp.placeholder = first ? tr('예) 우주에서 피자 먹는 고양이') : tr('뭘 만든 걸까요?');
  setTimeout(() => inp.focus(), 50);
}
function submitWrite() {
  if (S.phase !== 'step' || S.task?.type !== 'write') return;
  const text = $('#write-input').value.trim();
  if (!text && !S.autoSubmitted) { toast(S.round === 0 ? tr('제시어를 적어 주세요 (안 적으면 시간이 끝날 때 랜덤 제시어가 들어가요)') : tr('뭐라도 적어 보세요!')); return; }
  net.send({ type: 'submit', text });
}
function renderBuild() {
  showPhase('step-build');
  const t = S.task;
  $('#build-prompt').textContent = `“${t.prev?.text || '???'}”`;
  $('#build-prompt').title = tr('{name}님이 적은 글', { name: playerOf(t.prev?.by).name });
  S.editor = mountEditor($('#editor'));
  resetEditor(t.mine?.scene || emptyScene());
}
function submitBuild() {
  if (S.phase !== 'step' || S.task?.type !== 'build' || !S.editor) return;
  const scene = S.editor.toJSON();
  if (!scene.objects.length && !S.autoSubmitted) return toast(tr('아직 아무것도 없어요. 도형을 하나라도 넣어 보세요!'));
  let timelapse = null;
  try { timelapse = buildTimelapse(S.editor.frames); } catch (e) { console.warn('timelapse failed', e); }
  net.send({ type: 'submit', scene, timelapse });
}
function submitCurrent() { S.task?.type === 'write' ? submitWrite() : submitBuild(); }
function renderDone() {
  const w = $('#waiting');
  if (S.phase !== 'step' || !S.task) return w.classList.add('hidden');
  w.classList.toggle('hidden', !S.done);
  if (S.task.type === 'build') setLocked(S.done);
  $('#btn-unsubmit').disabled = S.deadline - now() < 3500;
  renderProgress();
}
function renderProgress() {
  const list = S.phase === 'step' ? S.seats : [];
  const mk = () => list.map(id => { const p = playerOf(id); return el('span', { class: `pav ${S.progress.includes(id) ? 'done' : ''} ${id === S.me ? 'me' : ''} ${p.connected ? '' : 'off'}`, title: p.name, html: avatarSVG(p.avatar, 28) }); });
  $('#progress').replaceChildren(...mk());
  $('#waiting-progress').replaceChildren(...mk());
}

// ───────── 타이머 ─────────
setInterval(() => {
  const ring = $('#timer-ring'), num = $('#timer-num'), timer = $('#timer');
  timer.style.visibility = S.inGame && S.deadline ? 'visible' : 'hidden';
  if (!S.inGame || !S.deadline) { num.textContent = '--'; ring.style.strokeDashoffset = 0; timer.classList.remove('urgent'); return; }
  const leftMs = Math.max(0, S.deadline - now()), left = Math.ceil(leftMs / 1000);
  num.textContent = fmtTime(left);
  const total = S.phase === 'guess' ? (S.settings?.guess || 40) : (S.settings?.[S.task?.type || 'write'] || 45);
  ring.style.strokeDashoffset = 119.4 * (1 - Math.min(1, leftMs / (total * 1000)));
  timer.classList.toggle('urgent', left <= 10 && left > 0);
  if (S.phase === 'step' && S.task && !S.done && !S.autoSubmitted && leftMs <= 0) { S.autoSubmitted = true; submitCurrent(); }
  if (S.phase === 'step' && S.done) $('#btn-unsubmit').disabled = leftMs < 3500;
}, 250);

// ───────── 앨범 공개 ─────────
function startAlbum(m) {
  S.phase = 'album'; S.deadline = 0; S.albums = m.task.albums; S.album = { index: m.task.index, step: m.task.step }; S.albumView = null;
  if (m.task.timelapse && S.albums[S.album.index]?.steps[S.album.step]) S.albums[S.album.index].steps[S.album.step].timelapse = m.task.timelapse;
  $('#round-info').innerHTML = tr('앨범 공개 <small>글과 3D가 어떻게 변해 갔을까요?</small>');
  $('#timer').classList.add('hidden');
  showPhase('phase-album');
  renderAlbum();
}
function renderAlbum() {
  if (S.phase !== 'album' || !S.albums) return;
  const { index, step } = S.album, album = S.albums[index], host = isHost();
  $('#album-nav').replaceChildren(el('div', { class: 'sub-h' }, tr('앨범 {i} / {n}', { i: index + 1, n: S.albums.length })), ...S.albums.map((a, i) => { const p = playerOf(a.author); return el('button', { class: `${i === index ? 'on' : ''} ${i < index ? 'seen' : ''}`, disabled: !host, onclick: () => net.send({ type: 'albumGo', album: i, step: 0 }) }, avatarNode(p, 30), tr('{name}의 앨범', { name: p.name })); }));
  $('#album-title').textContent = tr('{name}님의 앨범', { name: playerOf(album.author).name });
  const box = $('#album-steps');
  // 같은 앨범에서 한 장면씩 늘어날 때만 이어 붙이고, 그 외엔 처음부터 다시 그린다
  let view = S.albumView;
  if (!view || view.index !== index || step < view.shown - 1) {
    for (const v of S.viewers) v.dispose(); S.viewers = [];
    box.replaceChildren();
    view = S.albumView = { index, shown: 0, live: null };
  }
  for (let i = view.shown; i <= step; i++) {
    const s = album.steps[i], p = playerOf(s.by);
    if (view.live) { // 앞선 3D는 사진으로 바꿔 둔다(그래픽 메모리 절약)
      const { viewer, holder, scene } = view.live;
      viewer.stopTimelapse(true);
      const img = el('img', { class: 'snap', src: viewer.snapshot(), alt: tr('3D 작품'), title: tr('눌러서 다시 돌려 보기'), onclick: () => { holder.replaceChildren(); holder.classList.add('viewer-box'); makeViewer(holder, scene); } });
      viewer.dispose(); S.viewers = S.viewers.filter(v => v !== viewer);
      holder.classList.remove('viewer-box'); holder.replaceChildren(img);
      view.live = null;
    }
    const who = el('div', { class: 'who', html: tr(s.type === 'write' ? (i === 0 ? '<b>{name}</b>님이 적은 제시어' : '<b>{name}</b>님의 추측') : '<b>{name}</b>님이 만든 3D', { name: esc(p.name) }) });
    let body;
    if (s.type === 'write') body = el('div', { class: `bubble ${i === 0 ? '' : 'guess'}` }, s.text || '…');
    else { body = el('div', { class: 'viewer-box' }); const viewer = makeViewer(body, s.scene); view.live = { viewer, holder: body, scene: s.scene }; if (s.timelapse) viewer.playTimelapse(s.timelapse); }
    const replay = s.type === 'build' && s.timelapse ? el('button', { class: 'replay-btn', title: tr('만드는 과정을 처음부터 다시 봐요'), onclick: () => {
      let live = S.albumView?.live;
      if (!live || live.holder !== body) { body.replaceChildren(); body.classList.add('viewer-box'); const viewer = makeViewer(body, s.scene); live = { viewer, holder: body, scene: s.scene }; if (S.albumView && !S.albumView.live) S.albumView.live = live; }
      live.viewer.playTimelapse(s.timelapse);
    } }, el('span', { class: 'ic', html: ICONS.replay }), tr('과정 다시 보기')) : null;
    const bar = s.type === 'build' ? el('div', { class: 'step-bar' }, replay, likeButton(S.albums, index, i),
      shotButton(() => { const live = S.albumView?.live; if (live && live.holder === body) return live.viewer.snapshot('image/png'); return body.querySelector('img.snap')?.src || null; }, shotName(`album${index + 1}-${i + 1}`))) : null;
    box.append(el('div', { class: 'step-row' }, avatarNode(p, 48), el('div', {}, who, body, bar)));
    view.shown = i + 1;
  }
  box.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  const atEnd = index === S.albums.length - 1 && step === album.steps.length - 1;
  const ctl = $('#album-ctl');
  if (host) ctl.replaceChildren(
    el('button', { class: 'btn ghost', disabled: index === 0 && step === 0, onclick: () => net.send({ type: 'albumPrev' }) }, tr('← 이전')),
    atEnd ? el('button', { class: 'btn primary', onclick: () => net.send({ type: 'toLobby' }) }, tr('🏠 로비로')) : el('button', { class: 'btn primary', onclick: () => net.send({ type: 'albumNext' }) }, step === album.steps.length - 1 ? tr('다음 앨범 →') : tr('다음 →')));
  else ctl.replaceChildren(el('span', { class: 'note' }, atEnd ? tr('끝! 방장이 로비로 데려가 줄 거예요') : tr('방장({name})이 다음 장면을 넘겨 줘요', { name: playerOf(S.hostId).name })));
}

// ───────── 다같이 맞추기 ─────────
function startGuess(m) {
  S.phase = 'guess'; S.gAlbums = m.task.albums; S.guess = m.task.round; S.guessResult = S.guess?.result ? { ...S.guess.result, idx: S.guess.idx } : null; S.feed = []; S.deadline = S.guess?.deadline || 0;
  $('#timer').classList.remove('hidden');
  showPhase('phase-guess');
  renderGuess();
}
function renderGuess() {
  const G = S.guess; if (S.phase !== 'guess' || !G) return;
  S.deadline = G.done ? 0 : G.deadline;
  const album = S.gAlbums[G.idx], author = playerOf(G.author), builder = playerOf(G.builder);
  $('#round-info').innerHTML = tr('작품 {i} / {n} <small>다같이 맞추기</small>', { i: G.idx + 1, n: G.total });
  const self = G.author === G.builder;
  $('#guess-head').replaceChildren(el('h2', {}, tr('이 3D는 무엇일까요?')), el('span', { class: 'who' }, avatarNode(builder, 28), self ? tr('{name}님이 제시어를 내고 직접 만들었어요', { name: builder.name }) : tr('{author}님의 제시어를 {builder}님이 만들었어요', { author: author.name, builder: builder.name })),
    el('span', { class: 'step-bar' }, likeButton(S.gAlbums, G.idx, 1), shotButton(() => S.viewers[0]?.snapshot('image/png'), shotName(`guess${G.idx + 1}`))));
  if (S.guessViewerIdx !== G.idx) { clearViewers(); makeViewer($('#guess-viewer'), album?.steps[1]?.scene, { autoRotate: true }); S.guessViewerIdx = G.idx; S.guessPlayed = false; }
  if (G.done && G.timelapse && !S.guessPlayed) { S.guessPlayed = true; S.viewers[0]?.playTimelapse(G.timelapse); }   // 정답 공개 뒤 만드는 과정 되감기
  const me = S.me, role = me === G.author ? 'author' : me === G.builder ? 'builder' : 'guesser';
  const roleBox = $('#guess-role');
  // 누가 맞추는 사람인지 한눈에: 제시어 낸 사람·만든 사람은 빠진다
  const guessers = (G.guessers || (S.seats || []).filter(id => id !== G.author && id !== G.builder)).map(playerOf);
  const strip = el('div', { class: 'roles' }, el('span', { class: 'rl' }, tr('맞추는 사람')),
    ...guessers.map(p => el('span', { class: `rp ${G.solved?.includes(p.id) ? 'ok' : ''}` }, avatarNode(p, 20), p.name, G.solved?.includes(p.id) ? ' ✓' : '')),
    guessers.length ? null : el('span', {}, tr('없음')));
  if (role === 'author') roleBox.replaceChildren(strip, el('div', {}, tr(self ? '내가 내고 내가 만든 작품이에요.' : '내가 낸 제시어예요.') + ' ' + tr('뜻이 맞는 답에 ✓를 눌러 정답으로 인정해 주세요. 똑같이 적으면 자동으로 정답 처리돼요.')), el('div', { class: 'ans' }, G.answer || ''));
  else if (role === 'builder') roleBox.replaceChildren(strip, el('div', {}, tr('내가 만든 작품이에요! 누군가 맞히면 나도 2점을 받아요. 채팅으로 힌트는 주지 마세요 😉')));
  else roleBox.replaceChildren(strip, el('div', {}, G.solved?.includes(me) ? tr('정답! 다른 사람들이 맞히는 걸 지켜보세요 🎉') : tr('정답이 뭘까요? 아래에 적어 보세요. 먼저 맞히면 3점, 그다음은 1점!')));
  const inp = $('#guess-input'), btn = $('#guess-form button');
  const canGuess = role === 'guesser' && !G.done && !G.solved?.includes(me);
  inp.disabled = btn.disabled = false;
  inp.placeholder = canGuess ? tr('정답을 적어 보세요') : role === 'guesser' ? tr('채팅') : tr('채팅만 돼요 (낸 사람·만든 사람은 못 맞혀요)');
  const ctl = $('#guess-ctl');
  ctl.replaceChildren(...[!G.done && (role === 'author' || isHost()) ? el('button', { class: 'btn ghost small', onclick: () => net.send({ type: 'skipRound' }) }, tr('⏭ 건너뛰기')) : null].filter(Boolean));
  renderGuessFeed(); renderGuessResult(); renderScoreboard();
  if (!G.done) setTimeout(() => inp.focus(), 50);
}
function onGuessMade(m) {
  const G = S.guess; if (!G) return;
  const i = G.guesses.findIndex(g => g.id === m.guess.id);
  if (i >= 0) G.guesses[i] = m.guess; else { G.guesses.push(m.guess); S.feed.push({ kind: 'guess', id: m.guess.id }); }
  if (m.players) S.players = m.players;
  if (m.solved) G.solved = m.solved;
  if (m.guess.correct && m.guess.from === S.me) { toast(tr('정답이에요! 🎉')); renderGuess(); return; }
  renderGuessFeed(); renderScoreboard();
}
function renderGuessFeed() {
  const G = S.guess; if (!G) return;
  const box = $('#guess-feed'), me = S.me, isAuthor = me === G.author;
  const rows = [];
  const seen = new Set();
  for (const f of S.feed) {
    if (f.kind === 'chat') { const p = playerOf(f.from); rows.push(el('div', { class: 'gl-row chat' }, avatarNode(p, 24), el('span', { class: 'nm' }, p.name), el('span', { class: 'tx' }, f.text))); continue; }
    const g = G.guesses.find(x => x.id === f.id); if (!g) continue; seen.add(g.id); rows.push(guessRow(g));
  }
  for (const g of G.guesses) if (!seen.has(g.id)) rows.unshift(guessRow(g)); // 재접속 때 받은 과거 추측
  if (!rows.length) rows.push(el('div', { class: 'gl-row sys' }, tr('아직 아무도 답하지 않았어요')));
  box.replaceChildren(...rows);
  box.scrollTop = box.scrollHeight;
  function guessRow(g) {
    const p = playerOf(g.from);
    const text = g.text == null ? el('span', { class: 'tx hid' }, '●●●●●') : el('span', { class: 'tx' }, g.text);
    return el('div', { class: `gl-row ${g.correct ? 'correct' : ''}` }, avatarNode(p, 24), el('span', { class: 'nm' }, p.name), text,
      g.correct ? el('span', {}, tr('정답! ✓')) : (isAuthor && !G.done ? el('button', { class: 'judge', title: tr('정답으로 인정하기'), onclick: () => net.send({ type: 'judge', guessId: g.id }) }, tr('✓ 정답')) : null));
  }
}
function renderGuessResult() {
  const R = S.guessResult, box = $('#guess-result');
  if (!R || S.phase !== 'guess' || R.idx !== S.guess?.idx) return box.classList.add('hidden');
  box.classList.remove('hidden');
  const solvers = (R.solved || []).map(playerOf);
  box.replaceChildren(el('div', {}, tr('정답은…')), el('div', { class: 'ans' }, R.answer || ''),
    el('div', { class: 'solvers' }, ...solvers.map(p => el('span', { title: p.name, html: avatarSVG(p.avatar, 32) }))),
    el('div', {}, solvers.length ? tr('{names} 정답! 다음 작품으로 넘어가요', { names: solvers.map(p => p.name).join(', ') }) : tr('아무도 못 맞혔어요 😅 다음 작품으로 넘어가요')));
}
function renderScoreboard() {
  const box = $('#scoreboard');
  if (S.phase !== 'guess' || !S.settings?.scoreboard) return box.replaceChildren();
  const sorted = [...S.players].sort((a, b) => b.score - a.score);
  box.replaceChildren(el('h3', {}, tr('점수판')), ...sorted.map(p => el('div', { class: 'srow' }, avatarNode(p, 22), p.name, likesLabel(p), el('span', { class: 'pt' }, tr('{n}점', { n: p.score })))));
}

// ───────── 점수 ─────────
function startScore() {
  S.phase = 'score'; S.deadline = 0;
  $('#round-info').innerHTML = tr('결과 <small>수고했어요!</small>');
  $('#timer').classList.add('hidden');
  showPhase('phase-score');
  const sorted = [...S.players].sort((a, b) => b.score - a.score);
  const medal = ['🥇', '🥈', '🥉'];
  const mostLiked = Math.max(0, ...S.players.map(p => p.likes || 0));
  $('#ranking').replaceChildren(...sorted.map((p, i) => el('li', {}, el('span', { class: 'rk' }, medal[i] || `${i + 1}`), avatarNode(p, 40), p.name, likesLabel(p), p.likes && p.likes === mostLiked ? el('span', { class: 'best', title: tr('따봉을 제일 많이 받았어요') }, tr('인기상')) : null, el('span', { class: 'pt' }, tr('{n}점', { n: p.score })))));
  $('#score-ctl').replaceChildren(isHost() ? el('button', { class: 'btn primary big', onclick: () => net.send({ type: 'toLobby' }) }, tr('🏠 로비로')) : el('span', { class: 'lobby-note' }, tr('방장이 로비로 데려가 줄 거예요')));
}

// ───────── 이벤트 연결 ─────────
applyDom(document);
mountLangMenu($('#lang-slot'));
$('#name').value = S.name;
renderAvatar(); renderJoinTarget(); renderHowto();
$('#btn-avatar').onclick = () => { let a; do a = randomAvatar(); while (a.shape === S.avatar.shape && a.color === S.avatar.color); S.avatar = a; renderAvatar(); if (S.joined) net.send({ type: 'avatar', avatar: a }); };
$('#btn-join').onclick = join;
$('#name').addEventListener('keydown', e => { if (e.key === 'Enter') join(); });
$('#howto-prev').onclick = () => { S.howto = (S.howto + HOWTO.length - 1) % HOWTO.length; renderHowto(); };
$('#howto-next').onclick = () => { S.howto = (S.howto + 1) % HOWTO.length; renderHowto(); };
setInterval(() => { if (document.body.dataset.view === 'landing' && !document.querySelector('#howto:hover')) { S.howto = (S.howto + 1) % HOWTO.length; renderHowto(); } }, 7000);
$('#logo').onclick = e => { if (S.joined) { e.preventDefault(); if (confirm(tr('방에서 나갈까요?'))) leaveRoom(); } };
for (const b of $$('#lobby-tabs .tab')) b.onclick = () => { S.lobbyTab = b.dataset.tab; renderLobby(); };
$('#max-players').onchange = e => net.send({ type: 'settings', settings: { maxPlayers: Number(e.target.value) } });
$('#tab-custom').addEventListener('focusout', () => { if (customPending) { customPending = false; setTimeout(renderLobby, 0); } });
$('#btn-invite').onclick = invite;
$('#btn-leave').onclick = leaveRoom;
mountAds();
$('#btn-begin').onclick = () => net.send({ type: 'start' });
$('#chat-form').onsubmit = e => { e.preventDefault(); const i = $('#chat-input'); if (i.value.trim()) net.send({ type: 'chat', text: i.value.trim() }); i.value = ''; };
$('#write-form').onsubmit = e => { e.preventDefault(); submitWrite(); };
$('#build-done').onclick = submitBuild;
$('#btn-unsubmit').onclick = () => net.send({ type: 'unsubmit' });
$('#guess-form').onsubmit = e => { e.preventDefault(); const i = $('#guess-input'); const t = i.value.trim(); if (t) net.send({ type: 'chat', text: t }); i.value = ''; };
window.addEventListener('beforeunload', e => { if (S.inGame) { e.preventDefault(); e.returnValue = ''; } });
show('landing');
window.__dbg = { S, net, editor: getEditor };
window.__booted = true; // 부팅 감시(index.html)에 '끝까지 실행됨'을 알린다
