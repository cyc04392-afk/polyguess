// 게임 규칙 — 렌더링/DOM/네트워크에 의존하지 않는 순수 로직. 서버와 브라우저가 같이 쓴다.
// 글자(이름·설명·메시지)는 한국어 원문을 키로 두고 보여줄 때 t()로 번역한다(shared/i18n.js).
import { t } from './i18n.js';

export const LIMITS = { minPlayers: 2, maxPlayers: 14, textMax: 60, nameMax: 14, timeMin: 10, timeMax: 600 };
// 모드별 최소 인원: 릴레이는 3명, 다같이 맞추기는 2명(둘일 때는 제시어 낸 사람이 직접 만든다)
export const MIN_PLAYERS = { chain: 3, guess: 2 };
export const minPlayersFor = settings => MIN_PLAYERS[settings?.mode === 'guess' ? 'guess' : 'chain'];

// 제한시간 빠른 선택. dynamic 은 과반이 끝내면 카운트다운으로 줄어든다. 방장은 초 단위로 직접 바꿀 수도 있다(커스텀).
export const TIME_PRESETS = {
  fast: { key: 'fast', name: '빠름', write: 25, build: 60, guess: 25, dynamic: false },
  normal: { key: 'normal', name: '보통', write: 45, build: 120, guess: 40, dynamic: false },
  relaxed: { key: 'relaxed', name: '느긋하게', write: 90, build: 240, guess: 90, dynamic: false },
  dynamic: { key: 'dynamic', name: '다이나믹', write: 150, build: 420, guess: 60, dynamic: true },
};
export const DYNAMIC_COUNTDOWN = 15;

// time 은 write/build/guess/dynamic 에서 자동으로 계산되는 이름표('fast'… 또는 'custom')
// selfBuild: 다같이 맞추기에서 제시어 낸 사람이 직접 3D로 만들기(2명이면 항상 켜진 것으로 진행)
export const DEFAULT_SETTINGS = { mode: 'chain', time: 'normal', write: 45, build: 120, guess: 40, dynamic: false, turns: 'all', scoreboard: true, selfBuild: false, maxPlayers: 10 };

// 로비의 "사전 설정" 카드
export const PRESETS = [
  { key: 'normal', name: '일반', icon: '🧊', desc: '글 → 3D → 글 → 3D… 모두의 손을 거친 뒤 앨범을 함께 봐요 (3명부터)', settings: { mode: 'chain', time: 'normal', turns: 'all' } },
  { key: 'guess', name: '다같이 맞추기', icon: '🙋', desc: '한 사람이 만든 3D를 보고 나머지가 동시에 맞혀요. 먼저 맞히면 점수! (2명부터)', settings: { mode: 'guess', time: 'normal' } },
];

// 시간 숫자들이 어느 빠른 선택과 같은지(없으면 'custom')
export function timePresetFor(s) {
  return Object.values(TIME_PRESETS).find(t => t.write === s.write && t.build === s.build && t.guess === s.guess && !!t.dynamic === !!s.dynamic)?.key || 'custom';
}

export function sanitizeSettings(s = {}) {
  const d = DEFAULT_SETTINGS;
  const secs = (v, def) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(LIMITS.timeMax, Math.max(LIMITS.timeMin, n)) : def; };
  const turnsNum = Number(s.turns);
  const out = {
    mode: s.mode === 'guess' ? 'guess' : 'chain',
    write: secs(s.write, d.write), build: secs(s.build, d.build), guess: secs(s.guess, d.guess),
    dynamic: s.dynamic !== undefined ? !!s.dynamic : d.dynamic,
    turns: s.turns === 'all' || !Number.isFinite(turnsNum) ? 'all' : Math.min(LIMITS.maxPlayers, Math.max(2, Math.round(turnsNum))),
    scoreboard: s.scoreboard !== undefined ? !!s.scoreboard : d.scoreboard,
    selfBuild: s.selfBuild !== undefined ? !!s.selfBuild : d.selfBuild,
    maxPlayers: Number.isFinite(Number(s.maxPlayers)) ? Math.min(LIMITS.maxPlayers, Math.max(LIMITS.minPlayers, Math.round(Number(s.maxPlayers)))) : d.maxPlayers,
  };
  out.time = timePresetFor(out);
  return out;
}

// 방장이 보낸 일부 설정을 현재 설정에 입힌다. time 에 빠른 선택 이름이 오면 시간 숫자를 그 값으로 채운다.
export function applySettings(current, patch = {}) {
  const merged = { ...current, ...patch };
  const t = patch && TIME_PRESETS[patch.time];
  if (t) Object.assign(merged, { write: t.write, build: t.build, guess: t.guess, dynamic: !!t.dynamic });
  return sanitizeSettings(merged);
}

export function presetFor(settings) {
  return PRESETS.find(p => Object.entries(p.settings).every(([k, v]) => settings[k] === v))?.key || null;
}

export function canStart(settings, n) {
  const min = minPlayersFor(settings);
  if (n < min) return { ok: false, key: settings?.mode === 'guess' ? '다같이 맞추기는 최소 {min}명이 필요해요 (지금 {n}명)' : '릴레이는 최소 {min}명이 필요해요 (지금 {n}명)', params: { min, n } };
  if (n > settings.maxPlayers) return { ok: false, key: '이 방은 {max}명까지예요', params: { max: settings.maxPlayers } };
  return { ok: true };
}
// canStart 결과를 문장으로(언어를 주면 그 언어로)
export const reasonText = (check, lang) => (check?.ok ? '' : t(check.key, check.params, lang));

// 서버가 보내는 메시지 키. 클라이언트는 key+params 를 받아 자기 언어로 보여준다
export const MSG = {
  inGame: '게임이 진행 중이에요. 이번 판이 끝나면 들어올 수 있어요.',
  full: '방이 가득 찼어요.',
  noRoom: '방 {code}을(를) 찾을 수 없습니다.',
  timeUp: '(시간이 다 됐어요…)',
  defaultName: '플레이어{n}',
};

// ── 릴레이 ─────────────────────────────────────────────
// 앨범 a 는 좌석 a 의 글로 시작하고, 라운드 r 에는 좌석 (a + r) 의 사람이 이어받는다.
export function roundCount(settings, n) {
  if (settings.mode === 'guess') return 2;
  return settings.turns === 'all' ? n : Math.min(n, settings.turns);
}
export const stepType = round => (round % 2 === 0 ? 'write' : 'build');
export const assignee = (seats, album, round) => seats[(album + round) % seats.length];
// 다같이 맞추기에서 3D를 누가 만드는지: 설정이 켜져 있거나 2명뿐이면 제시어 낸 사람이 직접(같은 좌석), 아니면 다음 좌석
export const selfBuildFor = (settings, n) => settings?.mode === 'guess' && (!!settings.selfBuild || n <= 2);
export function stepAssignee(settings, seats, album, round) {
  if (settings?.mode === 'guess' && round === 1 && selfBuildFor(settings, seats.length)) return seats[album];
  return assignee(seats, album, round);
}
export function albumFor(seats, playerId, round) {
  const n = seats.length, i = seats.indexOf(playerId);
  return i < 0 ? -1 : (((i - round) % n) + n) % n;
}
// 단계별 제한시간(초)
export function timeFor(settings, type) {
  const v = Number(settings?.[type]);
  return Number.isFinite(v) && v > 0 ? v : (TIME_PRESETS.normal[type] || TIME_PRESETS.normal.write);
}

// ── 다같이 맞추기 점수 ─────────────────────────────────
export const SCORE = { firstGuess: 3, laterGuess: 1, builder: 2, author: 1 };

// ── 정답 비교 ──────────────────────────────────────────
export function normalizeAnswer(s) {
  return String(s || '').toLowerCase().replace(/[\s.,!?~'"`·\-_()]/g, '');
}
export function isExactMatch(guess, answer) {
  const g = normalizeAnswer(guess);
  return g !== '' && g === normalizeAnswer(answer);
}

// 빈 칸 제출/시간 초과 때 쓰는 제시어
export const PROMPT_SUGGESTIONS = [
  '머리에 뿔 달린 소', '우주에서 피자 먹는 고양이', '비 오는 날 우산 쓴 눈사람', '롤러코스터 타는 할머니', '선글라스 낀 바나나',
  '책상 위의 작은 화산', '춤추는 로봇 청소기', '무지개 위를 걷는 강아지', '케이크 속에 숨은 쥐', '하늘을 나는 자전거',
  '거꾸로 자라는 나무', '커피를 마시는 문어', '모자 쓴 달', '얼음 위의 펭귄 축구', '산 위의 등대',
  '공룡이 끄는 썰매', '수박 모양 집', '물고기가 운전하는 택시', '풍선을 든 코끼리', '구름 위의 침대',
  '왕관 쓴 개구리', '사막의 아이스크림 가게', '거대한 연필 다리', '지붕 위의 피아노', '토끼 귀 달린 로켓',
  '계단을 오르는 고래', '꽃이 핀 자동차', '도넛 행성', '우산 모양 비행기', '거북이 등 위의 도시',
];
export const pickRandom = arr => arr[Math.floor(Math.random() * arr.length)];
// 방 언어로 번역한 제시어 목록
export const promptSuggestions = lang => PROMPT_SUGGESTIONS.map(k => t(k, null, lang));
