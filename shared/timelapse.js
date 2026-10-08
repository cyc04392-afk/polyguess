// 타임랩스(만드는 과정 되감기) — 렌더러 무관(순수 JS). docs/PROTOCOL.md 3.2절.
// 편집기가 작업마다 모은 장면 스냅샷 열(Scene 객체 또는 JSON 문자열)을 "바뀐 물체만" 담은 프레임 열로 압축한다.
//   timelapse = { v: 1, n: 원래 스냅샷 수, frames: [ { bg?: 배경, set?: [Obj], del?: [id] }, … ] }
// 빈 장면에서 시작해 프레임을 차례로 적용하면 마지막이 완성 작품이 된다(서버가 마지막 프레임을 완성 작품에 맞춘다).
// 너무 길거나 크면 처음·끝을 남기고 고르게 솎는다.
import { sanitizeObject, emptyScene } from './scene.js';

export const TIMELAPSE_LIMITS = { frames: 240, bytes: 1_500_000, minFrames: 2 };
const num = (v, lo, hi, def = 0) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def; };

const parse = s => (typeof s === 'string' ? JSON.parse(s) : s);
const objKey = o => JSON.stringify(o);

// 고르게 count 개 고르기(처음·끝 포함)
export function pickEvenly(n, count) {
  if (count >= n) return Array.from({ length: n }, (_, i) => i);
  const out = new Set();
  for (let k = 0; k < count; k++) out.add(Math.round((k * (n - 1)) / (count - 1)));
  return [...out].sort((a, b) => a - b);
}

// 스냅샷 열 → 프레임(차이)들. 첫 프레임은 빈 장면 기준
export function diffFrames(scenes) {
  const frames = [];
  let prev = new Map(), prevBg = null;
  for (const sc of scenes) {
    const frame = {};
    if (sc.bg !== prevBg) { frame.bg = sc.bg; prevBg = sc.bg; }
    const cur = new Map();
    const set = [];
    for (const o of sc.objects || []) { const k = objKey(o); cur.set(o.id, k); if (prev.get(o.id) !== k) set.push(o); }
    const del = [];
    for (const id of prev.keys()) if (!cur.has(id)) del.push(id);
    if (set.length) frame.set = set;
    if (del.length) frame.del = del;
    frames.push(frame);
    prev = cur;
  }
  return frames;
}

// 편집기 스냅샷 열 → 타임랩스. 바뀐 게 없는 연속 스냅샷은 하나로. 2장 미만이면 null(보여 줄 과정이 없음)
export function buildTimelapse(snapshots, limits = TIMELAPSE_LIMITS) {
  const scenes = [];
  let last = null;
  for (const s of snapshots || []) {
    const str = typeof s === 'string' ? s : JSON.stringify(s);
    if (str === last) continue;
    last = str; scenes.push(parse(s));
  }
  if (scenes.length < 2) return null;
  let count = Math.min(scenes.length, limits.frames);
  for (;;) {
    const idx = pickEvenly(scenes.length, count);
    const frames = diffFrames(idx.map(i => scenes[i]));
    const tl = { v: 1, n: scenes.length, frames };
    const bytes = JSON.stringify(tl).length;
    if (bytes <= limits.bytes || count <= limits.minFrames) return tl;
    count = Math.max(limits.minFrames, Math.floor(count * 0.7));
  }
}

// 프레임 적용(제자리). state = { bg, objects: [] } — id 가 같으면 그 자리에 바꿔 끼운다
export function applyFrame(state, frame) {
  if (frame.bg !== undefined) state.bg = frame.bg;
  if (frame.del) { const d = new Set(frame.del); state.objects = state.objects.filter(o => !d.has(o.id)); }
  if (frame.set) for (const o of frame.set) { const i = state.objects.findIndex(x => x.id === o.id); if (i >= 0) state.objects[i] = o; else state.objects.push(o); }
  return state;
}
// 모든 프레임을 펼쳐 장면 열로(테스트·다른 엔진 이식용)
export function timelapseScenes(tl) {
  const state = emptyScene(), out = [];
  for (const f of tl.frames) { applyFrame(state, f); out.push({ v: 1, bg: state.bg, objects: state.objects.slice() }); }
  return out;
}

// 서버 검증: 모양·개수·크기를 확인하고 물체는 sanitizeObject 로. 마지막 상태가 완성 작품(finalScene)과 다르면 맞추는 프레임을 하나 붙인다.
// 쓸 수 없으면 null.
export function sanitizeTimelapse(tl, finalScene, limits = TIMELAPSE_LIMITS) {
  if (!tl || typeof tl !== 'object' || !Array.isArray(tl.frames) || !tl.frames.length) return null;
  if (tl.frames.length > limits.frames) return null;
  const frames = [];
  for (const f of tl.frames) {
    if (!f || typeof f !== 'object') return null;
    const out = {};
    if (f.bg !== undefined) out.bg = Math.round(num(f.bg, 0, 20, 0));
    if (f.set !== undefined) { if (!Array.isArray(f.set)) return null; const set = f.set.map(sanitizeObject).filter(Boolean); if (set.length) out.set = set; }
    if (f.del !== undefined) { if (!Array.isArray(f.del)) return null; const del = f.del.map(v => Math.round(num(v, 1, 1e9, 0))).filter(v => v > 0); if (del.length) out.del = del; }
    frames.push(out);
  }
  // 완성 작품과 맞추기
  if (finalScene) {
    const state = emptyScene();
    for (const f of frames) applyFrame(state, f);
    const fin = diffFromState(state, finalScene);
    if (fin) frames.push(fin);
  }
  const out = { v: 1, n: Math.round(num(tl.n, frames.length, 1e6, frames.length)), frames };
  if (JSON.stringify(out).length > limits.bytes * 1.1) return null;
  return out;
}
// state → target 으로 가는 프레임(같으면 null)
function diffFromState(state, target) {
  const prev = new Map(state.objects.map(o => [o.id, objKey(o)]));
  const frame = {};
  if (target.bg !== state.bg) frame.bg = target.bg;
  const set = [], cur = new Set();
  for (const o of target.objects || []) { cur.add(o.id); if (prev.get(o.id) !== objKey(o)) set.push(o); }
  const del = [...prev.keys()].filter(id => !cur.has(id));
  if (set.length) frame.set = set;
  if (del.length) frame.del = del;
  return Object.keys(frame).length ? frame : null;
}
