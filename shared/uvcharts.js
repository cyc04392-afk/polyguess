// 면 차트 아틀라스 — 렌더러 무관(순수 JS). 페인트(붓 칠)를 텍스처 그림에 그리기 위한 UV 규칙.
//
// 물체의 텍스처는 size×size 픽셀 그림이고, cell×cell 칸이 cols×cols 로 깔려 있다. 면 fi 는 칸 (fi % cols, ⌊fi / cols⌋) 하나를 통째로 쓴다.
// 면은 자기 평면 위에 투영된다: 원점 P0(첫 꼭짓점), 축 u(첫 모서리 방향에서 법선 성분을 뺀 것), w = n × u.
// 투영한 다각형을 칸 안쪽(pad 만큼 띄운 네모)에 비율을 지키며 가운데 맞춰 넣는다. 저장 포맷은 { s: size, c: cell, png } (docs/PROTOCOL.md 4절).
// 꼭짓점이 움직이면(찰흙·점 편집) 투영도 따라 바뀌므로 UV 를 다시 계산한다. 위상이 바뀌면 새 면의 칸을 원래 면(faceOrigin)의 칸에서
// 아핀 변환으로 다시 굽는다(chartAffine). 유니티 등 다른 엔진도 이 규칙으로 UV 를 만들면 같은 그림을 쓸 수 있다.
import { pmFaceNormal, pmFaceCenter } from './polymesh.js';

export const TEX_SIZES = [256, 512, 1024, 2048];
export const TEX_HEADROOM = 1.3;      // 칸을 면 수보다 넉넉히(루프 자르기·인셋으로 면이 늘어도 배치를 안 바꾸게)
export const MIN_CELL = 4, MAX_CELL = 256;

export function makeLayout(size, cell) {
  const cols = Math.max(1, Math.floor(size / cell));
  return { size, cell, cols, cap: cols * cols, pad: Math.max(1, Math.round(cell * 0.06)) };
}
// 면 수에 맞는 배치. 칸은 4~256px, 그림은 1024(면이 아주 많으면 2048)
export function chartLayout(faceCount, size = null) {
  const want = Math.ceil(Math.sqrt(Math.max(1, faceCount) * TEX_HEADROOM));
  const s = size || (Math.floor(1024 / want) >= MIN_CELL ? 1024 : 2048);
  const cell = Math.max(MIN_CELL, Math.min(MAX_CELL, Math.floor(s / want)));
  return makeLayout(s, cell);
}
export const layoutFits = (layout, faceCount) => faceCount <= layout.cap;
export const sameLayout = (a, b) => !!a && !!b && a.size === b.size && a.cell === b.cell;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// 면 하나의 투영 기준과 칸 안 위치
//  { fi, P0, u, w, n, minx, miny, scale(px/단위), ox, oy(투영 최소점의 픽셀 자리), cx, cy(칸 왼쪽 위), r(면 중심에서 꼭짓점까지 최대 거리) }
export function faceChart(pm, fi, layout) {
  const face = pm.f[fi], v = pm.v, P0 = v[face[0]];
  let n = pmFaceNormal(pm, fi);
  if (!(Math.hypot(n[0], n[1], n[2]) > 0.5)) n = [0, 1, 0];
  let u = sub(v[face[1]], P0);
  const d = dot(u, n); u = [u[0] - n[0] * d, u[1] - n[1] * d, u[2] - n[2] * d];
  if (Math.hypot(u[0], u[1], u[2]) < 1e-9) u = cross(n, Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]);
  u = norm(u);
  const w = cross(n, u);
  let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
  for (const vi of face) {
    const p = sub(v[vi], P0), x = dot(p, u), y = dot(p, w);
    if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y;
  }
  const inner = Math.max(1, layout.cell - 2 * layout.pad);
  const scale = inner / Math.max(maxx - minx, maxy - miny, 1e-9);
  const cx = (fi % layout.cols) * layout.cell, cy = Math.floor(fi / layout.cols) * layout.cell;
  const ox = cx + layout.pad + (inner - (maxx - minx) * scale) / 2;
  const oy = cy + layout.pad + (inner - (maxy - miny) * scale) / 2;
  return { fi, P0, u, w, n, minx, miny, scale, ox, oy, cx, cy };
}
export function faceCharts(pm, layout) { const out = new Array(pm.f.length); for (let fi = 0; fi < pm.f.length; fi++) out[fi] = faceChart(pm, fi, layout); return out; }

// 3D(로컬) 점 → 그 면의 칸 픽셀 좌표(면 평면에 법선 방향으로 내려 찍은 자리)
export function chartPixel(ch, p) {
  const dx = p[0] - ch.P0[0], dy = p[1] - ch.P0[1], dz = p[2] - ch.P0[2];
  return [(dx * ch.u[0] + dy * ch.u[1] + dz * ch.u[2] - ch.minx) * ch.scale + ch.ox, (dx * ch.w[0] + dy * ch.w[1] + dz * ch.w[2] - ch.miny) * ch.scale + ch.oy];
}
// 칸 픽셀 좌표 → 면 평면 위 3D 점
export function chartPoint(ch, x, y) {
  const a = (x - ch.ox) / ch.scale + ch.minx, b = (y - ch.oy) / ch.scale + ch.miny;
  return [ch.P0[0] + a * ch.u[0] + b * ch.w[0], ch.P0[1] + a * ch.u[1] + b * ch.w[1], ch.P0[2] + a * ch.u[2] + b * ch.w[2]];
}
// 점에서 면 평면까지의 부호 있는 거리(법선 방향)
export const chartHeight = (ch, p) => (p[0] - ch.P0[0]) * ch.n[0] + (p[1] - ch.P0[1]) * ch.n[1] + (p[2] - ch.P0[2]) * ch.n[2];

// 렌더 버퍼 코너(pmRenderBuffers 의 cornerVertex/triFace)마다 UV(0~1, v 는 그림 위에서 아래로) → Float32Array(2n) 또는 out 에 채움
export function cornerUVs(pm, charts, layout, cornerVertex, triFace, out = null) {
  const n = cornerVertex.length, uv = out || new Float32Array(n * 2), centers = new Map(), s = layout.size;
  for (let i = 0; i < n; i++) {
    const fi = triFace[(i / 3) | 0], ch = charts[fi], vi = cornerVertex[i];
    let p;
    if (vi >= 0) p = pm.v[vi];
    else { p = centers.get(fi); if (!p) { p = pmFaceCenter(pm, fi); centers.set(fi, p); } }
    const [x, y] = chartPixel(ch, p);
    uv[i * 2] = x / s; uv[i * 2 + 1] = y / s;
  }
  return uv;
}
// 면 코너 순서(pm.f 순서 그대로)의 UV — 파일 내보내기용. flipV 면 v 를 아래에서 위로(OBJ·FBX 관례)
export function polygonUVs(pm, charts, layout, flipV = true) {
  const out = [], s = layout.size;
  pm.f.forEach((face, fi) => { const ch = charts[fi]; for (const vi of face) { const [x, y] = chartPixel(ch, pm.v[vi]); out.push([x / s, flipV ? 1 - y / s : y / s]); } });
  return out;
}

// 새 면의 칸(dst) 픽셀 → 원래 면의 칸(src) 픽셀 아핀 변환 { a, b, c, d, e, f } (src = [a c e; b d f]·[x y 1]).
// pointMap 은 새 메시 좌표를 원래 메시 좌표로 옮기는 함수(좌우 뒤집기 등), 없으면 그대로.
export function chartAffine(dst, src, pointMap = null) {
  const f = (x, y) => { let p = chartPoint(dst, x, y); if (pointMap) p = pointMap(p); return chartPixel(src, p); };
  const o = f(0, 0), px = f(1, 0), py = f(0, 1);
  return { a: px[0] - o[0], b: px[1] - o[1], c: py[0] - o[0], d: py[1] - o[1], e: o[0], f: o[1] };
}
export const applyAffine = (m, x, y) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f];
// 역변환. 거의 특이(면이 원래 면과 직각: 밀어내기 옆면 등)하면 null
export function invertAffine(m) {
  const det = m.a * m.d - m.b * m.c;
  if (!(Math.abs(det) > 1e-4 * (m.a * m.a + m.b * m.b + m.c * m.c + m.d * m.d))) return null;
  return { a: m.d / det, b: -m.b / det, c: -m.c / det, d: m.a / det, e: (m.c * m.f - m.d * m.e) / det, f: (m.b * m.e - m.a * m.f) / det };
}
// 두 면의 투영 기준이 같은가(꼭짓점이 안 움직였고 같은 칸이면 다시 구울 필요가 없다)
export function sameChart(a, b, eps = 1e-7) {
  if (!a || !b || a.cx !== b.cx || a.cy !== b.cy) return false;
  for (let k = 0; k < 3; k++) if (Math.abs(a.P0[k] - b.P0[k]) > eps || Math.abs(a.u[k] - b.u[k]) > eps || Math.abs(a.w[k] - b.w[k]) > eps) return false;
  return Math.abs(a.minx - b.minx) <= eps && Math.abs(a.miny - b.miny) <= eps && Math.abs(a.scale - b.scale) <= eps * Math.max(1, a.scale) && Math.abs(a.ox - b.ox) <= 1e-6 && Math.abs(a.oy - b.oy) <= 1e-6;
}

// 면 대응(faceOrigin)을 모를 때: 새 면마다 "같은 평면 위에 있고 법선이 비슷하며 가까운" 원래 면 번호(paint.js transferPaint 와 같은 규칙)
export function nearestFaces(oldPm, newPm) {
  const M = oldPm.f.length, oc = new Float32Array(M * 3), on = new Float32Array(M * 3);
  for (let i = 0; i < M; i++) { oc.set(pmFaceCenter(oldPm, i), i * 3); on.set(pmFaceNormal(oldPm, i), i * 3); }
  const out = new Int32Array(newPm.f.length);
  for (let i = 0; i < newPm.f.length; i++) {
    const c = pmFaceCenter(newPm, i), n = pmFaceNormal(newPm, i);
    let best = 0, bs = Infinity;
    for (let j = 0; j < M; j++) {
      const dx = c[0] - oc[j * 3], dy = c[1] - oc[j * 3 + 1], dz = c[2] - oc[j * 3 + 2];
      const nx = on[j * 3], ny = on[j * 3 + 1], nz = on[j * 3 + 2];
      const s = Math.abs(dx * nx + dy * ny + dz * nz) + 0.5 * (1 - (n[0] * nx + n[1] * ny + n[2] * nz)) + 0.05 * Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (s < bs) { bs = s; best = j; }
    }
    out[i] = best;
  }
  return out;
}
