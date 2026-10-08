// 3D 작품의 저장 포맷과 검증 — 렌더러 무관. 포맷 정의는 docs/PROTOCOL.md.
//
// Scene = { v: 1, bg: 배경 인덱스, objects: Obj[] }
// Obj   = { id, kind, p:[x,y,z], q:[x,y,z,w], s:[x,y,z], mat:{ c:'#rrggbb', f:'basic'|'shiny'|'metal'|'glass'|'glow' },
//           mesh?:  { pos: base64(Float32[]), fv: base64(Uint32[] 면 꼭짓점 번호를 이어 붙인 것), fn: base64(Uint8[] 면마다 꼭짓점 개수) }
//                   (kind==='mesh': 찰흙·베벨·루프 자르기 등으로 다듬은 다각형 메시. 옛 포맷 { pos, idx(삼각형) } 도 읽는다)
//           light?: { type:'sun'|'point'|'spot', i: 세기, a: 스포트 각도(도) }  (kind==='light': 광원. 방향은 q 로, 위치는 p 로)
//           tex?:   { s: 그림 한 변(256|512|1024|2048), c: 면 칸 한 변(px), png: base64(PNG, 투명 바탕 위 붓 자국) }  (페인트 그림. UV 규칙은 shared/uvcharts.js)
//           paint?: { pal:['#rrggbb', …](최대 32), f: base64(Uint8[] 면마다 색 번호. 0 = 물체 색, k = pal[k-1]) }  (옛 면 색칠. 읽기만 하고 새로 저장하지 않는다)
import { makePrimitive } from './primitives.js';
import { TEX_SIZES } from './uvcharts.js';

export const SCENE_LIMITS = { objects: 150, meshVerts: 80000, meshFaces: 120000, lights: 4, jsonBytes: 12_000_000, paintColors: 32, texChars: 2_400_000 };
export const PRIM_KINDS = ['box', 'sphere', 'cylinder', 'cone', 'torus', 'capsule', 'slab', 'pyramid', 'hemisphere', 'prism3', 'prism6', 'star', 'heart', 'clay'];
export const FINISH_KEYS = ['basic', 'shiny', 'metal', 'glass', 'glow'];
export const LIGHT_TYPES = ['sun', 'point', 'spot'];
export const LIGHT_RANGE = { intensity: [0.1, 6], angle: [10, 80] };
export const DEFAULT_LIGHT = { type: 'sun', i: 1.6, a: 40 };

export function emptyScene() { return { v: 1, bg: 0, objects: [] }; }

// ── base64 ↔ typed array (Node, 브라우저 공용) ──
function bytesToB64(bytes) {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function b64ToBytes(str) {
  if (typeof Buffer !== 'undefined') { const b = Buffer.from(str, 'base64'); return new Uint8Array(b.buffer, b.byteOffset, b.byteLength); }
  const s = atob(str), out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
export const b64 = {
  fromF32: arr => bytesToB64(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength)),
  fromU32: arr => bytesToB64(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength)),
  fromU8: arr => bytesToB64(arr instanceof Uint8Array ? arr : Uint8Array.from(arr)),
  toF32: str => new Float32Array(b64ToBytes(str).slice().buffer),
  toU32: str => new Uint32Array(b64ToBytes(str).slice().buffer),
  toU8: str => b64ToBytes(str).slice(),
};

const num = (v, lo, hi, def = 0) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def; };
const isHex = c => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c);

// 메시 데이터만 검사해서 정규화된 { pos, fv, fn } 또는 옛 포맷 { pos, idx } 를 돌려준다. 문제가 있으면 null.
export function sanitizeMesh(m) {
  if (!m || typeof m.pos !== 'string') return null;
  let pos;
  try { pos = b64.toF32(m.pos); } catch { return null; }
  const nv = pos.length / 3;
  if (!Number.isInteger(nv) || nv < 3 || nv > SCENE_LIMITS.meshVerts) return null;
  for (let i = 0; i < pos.length; i++) if (!Number.isFinite(pos[i])) return null;
  if (typeof m.fv === 'string' && typeof m.fn === 'string') {
    let fv, fn;
    try { fv = b64.toU32(m.fv); fn = b64.toU8(m.fn); } catch { return null; }
    if (fn.length < 1 || fn.length > SCENE_LIMITS.meshFaces) return null;
    let total = 0;
    for (let i = 0; i < fn.length; i++) { if (fn[i] < 3) return null; total += fn[i]; }
    if (total !== fv.length) return null;
    for (let i = 0; i < fv.length; i++) if (fv[i] >= nv) return null;
    return { pos: m.pos, fv: m.fv, fn: m.fn };
  }
  // 옛 포맷: 삼각형 인덱스(또는 인덱스 없는 삼각형 묶음)
  let idx = null;
  try { if (m.idx != null) idx = b64.toU32(String(m.idx)); } catch { return null; }
  if (idx) {
    if (idx.length % 3 !== 0 || idx.length > SCENE_LIMITS.meshVerts * 6) return null;
    for (let i = 0; i < idx.length; i++) if (idx[i] >= nv) return null;
  } else if (nv % 3 !== 0) return null;
  return { pos: m.pos, idx: idx ? String(m.idx) : null };
}

export function sanitizeLight(l) {
  const type = LIGHT_TYPES.includes(l?.type) ? l.type : DEFAULT_LIGHT.type;
  return {
    type,
    i: +num(l?.i, LIGHT_RANGE.intensity[0], LIGHT_RANGE.intensity[1], DEFAULT_LIGHT.i).toFixed(2),
    a: Math.round(num(l?.a, LIGHT_RANGE.angle[0], LIGHT_RANGE.angle[1], DEFAULT_LIGHT.a)),
  };
}

// 기본 도형의 면 수(면 색칠 길이 검사용). 찰흙 덩어리는 처음부터 촘촘한 버전.
const primFaces = new Map();
export function primitiveFaceCount(kind) {
  if (!PRIM_KINDS.includes(kind)) return 0;
  if (!primFaces.has(kind)) primFaces.set(kind, makePrimitive(kind, kind === 'clay').f.length);
  return primFaces.get(kind);
}
// 면 색칠 검사: 길이가 면 수와 다르거나 깨졌으면 버린다(null). 범위 밖 번호는 0(물체 색)으로
export function sanitizePaint(p, faceCount) {
  if (!p || typeof p.f !== 'string' || !Array.isArray(p.pal) || !faceCount) return null;
  let f;
  try { f = b64.toU8(p.f); } catch { return null; }
  if (f.length !== faceCount) return null;
  const pal = p.pal.slice(0, SCENE_LIMITS.paintColors).map(c => (isHex(c) ? c.toLowerCase() : '#d9d9e3'));
  let any = false;
  for (let i = 0; i < f.length; i++) { if (f[i] > pal.length) f[i] = 0; if (f[i]) any = true; }
  return any && pal.length ? { pal, f: b64.fromU8(f) } : null;
}

// 페인트 그림 검사: 크기·칸이 말이 되고 PNG(base64)처럼 생겼으며 너무 크지 않으면 통과, 아니면 null
export function sanitizeTex(t) {
  if (!t || typeof t.png !== 'string' || !t.png.length) return null;
  const s = Number(t.s), c = Math.round(Number(t.c));
  if (!TEX_SIZES.includes(s) || !(c >= 2 && c <= s)) return null;
  if (t.png.length > SCENE_LIMITS.texChars || !/^iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(t.png)) return null;
  return { s, c, png: t.png };
}
// 타임랩스·비교용: 페인트 그림을 뺀 장면(새 객체, 나머지는 공유)
export function stripTex(scene) {
  if (!scene?.objects?.some(o => o && o.tex)) return scene;
  return { ...scene, objects: scene.objects.map(o => { if (!o || !o.tex) return o; const { tex, ...rest } = o; return rest; }) };
}

export function sanitizeObject(o) {
  if (!o || typeof o !== 'object') return null;
  const kind = String(o.kind || '');
  const out = {
    id: Math.round(num(o.id, 1, 1e9, 1)),
    kind,
    p: [0, 1, 2].map(i => +num(o.p?.[i], -1000, 1000).toFixed(4)),
    q: [0, 1, 2, 3].map(i => num(o.q?.[i], -1, 1, i === 3 ? 1 : 0)),
    s: [0, 1, 2].map(i => +num(o.s?.[i], 0.01, 200, 1).toFixed(4)),
    mat: { c: isHex(o.mat?.c) ? o.mat.c.toLowerCase() : '#d9d9e3', f: FINISH_KEYS.includes(o.mat?.f) ? o.mat.f : 'basic' },
  };
  const ql = Math.hypot(...out.q) || 1;
  out.q = out.q.map(v => +(v / ql).toFixed(5));
  if (PRIM_KINDS.includes(kind)) {
    const tex = sanitizeTex(o.tex);
    if (tex) out.tex = tex;
    else { const paint = sanitizePaint(o.paint, primitiveFaceCount(kind)); if (paint) out.paint = paint; }
    return out;
  }
  if (kind === 'mesh') {
    const mesh = sanitizeMesh(o.mesh);
    if (!mesh) return null;
    out.mesh = mesh;
    const tex = sanitizeTex(o.tex);
    if (tex) out.tex = tex;
    else { const paint = mesh.fn ? sanitizePaint(o.paint, b64.toU8(mesh.fn).length) : null; if (paint) out.paint = paint; }
    return out;
  }
  if (kind === 'light') {
    out.s = [1, 1, 1];
    out.light = sanitizeLight(o.light);
    return out;
  }
  return null;
}

export function sanitizeScene(scene) {
  if (!scene || typeof scene !== 'object' || !Array.isArray(scene.objects)) return emptyScene();
  const objects = [];
  const seen = new Set();
  let lights = 0;
  for (const o of scene.objects.slice(0, SCENE_LIMITS.objects)) {
    const c = sanitizeObject(o);
    if (!c || seen.has(c.id)) continue;
    if (c.kind === 'light' && ++lights > SCENE_LIMITS.lights) continue;
    seen.add(c.id);
    objects.push(c);
  }
  return { v: 1, bg: Math.round(num(scene.bg, 0, 20, 0)), objects };
}

export function sceneStats(scene) {
  let verts = 0, lights = 0;
  for (const o of scene.objects) {
    if (o.kind === 'mesh') verts += Math.floor((o.mesh.pos.length * 3) / 4 / 3 / 4);
    if (o.kind === 'light') lights++;
  }
  return { objects: scene.objects.length, approxMeshVerts: verts, lights };
}
