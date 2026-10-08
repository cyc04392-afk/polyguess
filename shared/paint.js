// 면 색칠(페인트) 데이터 — 렌더러 무관(순수 JS). 물체마다 paint = { pal: ['#rrggbb', …](최대 32), f: Uint8Array(면 수) }
// f[i] 는 i번째 면의 색: 0 = 물체 색(mat.c) 그대로, k = pal[k-1]. 저장 포맷은 { pal, f: base64(Uint8[]) } (docs/PROTOCOL.md 4절).
import { b64 } from './scene.js';
import { pmFaceCenter, pmFaceNormal } from './polymesh.js';

export const PAINT_MAX_COLORS = 32;
const isHex = c => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c);

export function makePaint(faceCount) { return { pal: [], f: new Uint8Array(faceCount) }; }
export function clonePaint(paint) { return paint ? { pal: paint.pal.slice(), f: Uint8Array.from(paint.f) } : null; }
export function isPainted(paint) { if (!paint) return false; for (let i = 0; i < paint.f.length; i++) if (paint.f[i]) return true; return false; }

// 색 → 팔레트 번호(1부터). 없으면 추가하고, 팔레트가 가득 찼으면 가장 비슷한 색의 번호
export function paintColorIndex(paint, hex) {
  const c = String(hex).toLowerCase();
  if (!isHex(c)) return 0;
  const i = paint.pal.indexOf(c);
  if (i >= 0) return i + 1;
  if (paint.pal.length < PAINT_MAX_COLORS) { paint.pal.push(c); return paint.pal.length; }
  let best = 0, bd = Infinity;
  const [r, g, b] = rgb(c);
  paint.pal.forEach((p, k) => { const [pr, pg, pb] = rgb(p); const d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2; if (d < bd) { bd = d; best = k; } });
  return best + 1;
}
const rgb = c => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];

// 면 하나의 실제 색(없으면 null = 물체 색)
export function faceColor(paint, fi) { const k = paint?.f[fi]; return k ? paint.pal[k - 1] || null : null; }

// 안 쓰는 색을 팔레트에서 빼고 번호를 다시 매긴다(저장 전). 칠한 면이 하나도 없으면 null
export function trimPalette(paint) {
  if (!isPainted(paint)) return null;
  const used = new Map();
  const f = new Uint8Array(paint.f.length), pal = [];
  for (let i = 0; i < paint.f.length; i++) {
    const k = paint.f[i];
    if (!k || !paint.pal[k - 1]) continue;
    let n = used.get(k);
    if (n === undefined) { pal.push(paint.pal[k - 1]); n = pal.length; used.set(k, n); }
    f[i] = n;
  }
  return pal.length ? { pal, f } : null;
}
export function paintToJSON(paint) { const t = trimPalette(paint); return t ? { pal: t.pal, f: b64.fromU8(t.f) } : null; }
export function paintFromJSON(j, faceCount) {
  if (!j || typeof j.f !== 'string' || !Array.isArray(j.pal)) return null;
  let f; try { f = b64.toU8(j.f); } catch { return null; }
  if (f.length !== faceCount) return null;
  const pal = j.pal.slice(0, PAINT_MAX_COLORS).map(c => (isHex(c) ? c.toLowerCase() : '#d9d9e3'));
  for (let i = 0; i < f.length; i++) if (f[i] > pal.length) f[i] = 0;
  const paint = { pal, f };
  return isPainted(paint) ? paint : null;
}

// 위상이 바뀐 뒤 색 옮기기: faceOrigin[i] = 새 면 i 가 물려받을 원래 면(없으면 -1)
export function remapPaint(paint, faceOrigin) {
  if (!isPainted(paint)) return null;
  const f = new Uint8Array(faceOrigin.length);
  for (let i = 0; i < faceOrigin.length; i++) { const o = faceOrigin[i]; f[i] = o >= 0 && o < paint.f.length ? paint.f[o] : 0; }
  const out = { pal: paint.pal.slice(), f };
  return isPainted(out) ? out : null;
}

// 면 대응을 모를 때(찰흙용 촘촘한 도형으로 바꿀 때 등): 새 면마다 "같은 평면 위에 있고 법선이 비슷하며 가까운" 옛 면의 색을 가져온다.
// (중심 거리만 쓰면 넓은 면의 가장자리 칸이 옆면 색을 받는다.) 옛 면은 기본 도형 수준(수백 개)이라 전수 비교로 충분하다.
export function transferPaint(oldPm, paint, newPm) {
  if (!isPainted(paint) || !oldPm?.f.length || !newPm?.f.length) return null;
  const M = oldPm.f.length;
  const oc = new Float32Array(M * 3), on = new Float32Array(M * 3);
  for (let i = 0; i < M; i++) { oc.set(pmFaceCenter(oldPm, i), i * 3); on.set(pmFaceNormal(oldPm, i), i * 3); }
  const f = new Uint8Array(newPm.f.length);
  for (let i = 0; i < newPm.f.length; i++) {
    const c = pmFaceCenter(newPm, i), n = pmFaceNormal(newPm, i);
    let best = 0, bs = Infinity;
    for (let j = 0; j < M; j++) {
      const dx = c[0] - oc[j * 3], dy = c[1] - oc[j * 3 + 1], dz = c[2] - oc[j * 3 + 2];
      const nx = on[j * 3], ny = on[j * 3 + 1], nz = on[j * 3 + 2];
      const s = Math.abs(dx * nx + dy * ny + dz * nz) + 0.5 * (1 - (n[0] * nx + n[1] * ny + n[2] * nz)) + 0.05 * Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (s < bs) { bs = s; best = j; }
    }
    f[i] = paint.f[best];
  }
  const out = { pal: paint.pal.slice(), f };
  return isPainted(out) ? out : null;
}
