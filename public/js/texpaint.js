// 텍스처 페인트: 물체마다 그림(캔버스)을 들고 붓으로 모델 표면에 직접 그린다. UV 규칙은 shared/uvcharts.js(면마다 칸 하나).
// userData.tex = { canvas, ctx, texture(CanvasTexture), layout, charts, png(저장용 캐시), gen(그린 횟수), empty, loading }
// 그림은 투명 바탕 위의 붓 자국이고, 셰이더가 물체 색 위에 알파로 섞는다(sceneio.js PAINT_SHADER). 저장은 PNG(base64) — { s, c, png }.
import * as THREE from 'three';
import { chartLayout, makeLayout, layoutFits, faceCharts, chartPixel, chartHeight, chartAffine, invertAffine, applyAffine, cornerUVs, sameLayout, sameChart, nearestFaces } from '../shared/uvcharts.js';
import { pmFaceCenter, pmFaceNormal } from '../shared/polymesh.js';

export const hasTex = obj => !!obj?.userData?.tex;
const PNG_PREFIX = 'data:image/png;base64,';

function makeCanvas(size) { const c = document.createElement('canvas'); c.width = c.height = size; return c; }

// 최근에 저장한 그림(png → 캔버스 복사본): 되돌리기(JSON 에서 다시 만들기)를 기다림 없이 하려고
const recent = new Map();
const RECENT_MAX = 8;
function remember(png, canvas) {
  if (recent.has(png)) { const keep = recent.get(png); recent.delete(png); recent.set(png, keep); return; }
  const copy = makeCanvas(canvas.width); copy.getContext('2d').drawImage(canvas, 0, 0);
  recent.set(png, copy);
  while (recent.size > RECENT_MAX) recent.delete(recent.keys().next().value);
}
const recall = png => recent.get(png) || null;

// 물체에 텍스처를 만든다(이미 있으면 그대로). layout 을 주면 그 배치(불러오기·복사), 아니면 면 수에 맞게
export function ensureTex(obj, layout = null) {
  const u = obj.userData;
  if (u.tex) return u.tex;
  const L = layout || chartLayout(u.pm.f.length);
  const canvas = makeCanvas(L.size), ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.flipY = false; texture.colorSpace = THREE.SRGBColorSpace; texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter; texture.magFilter = THREE.LinearFilter;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  u.tex = { canvas, ctx, texture, layout: L, charts: null, png: null, gen: 0, empty: true, loading: false };
  refreshCharts(obj);
  attachMap(obj);
  return u.tex;
}
export function attachMap(obj) {
  const m = obj.material, want = obj.userData.tex?.texture || null;
  if (!m || m.map === want) return;
  m.map = want; m.needsUpdate = true;
}
export function disposeTex(obj) {
  const u = obj.userData, T = u.tex; if (!T) return;
  u.tex = null;
  T.texture.dispose();
  attachMap(obj);
  if (obj.geometry?.getAttribute('uv')) obj.geometry.deleteAttribute('uv');
}
// 꼭짓점이 움직였거나 메시가 바뀐 뒤: 면 차트와 지오메트리의 UV 를 다시 계산
export function refreshCharts(obj) {
  const u = obj.userData, T = u.tex; if (!T) return;
  T.charts = faceCharts(u.pm, T.layout);
  const g = obj.geometry, b = u.buffers, n = b.cornerVertex.length;
  let attr = g.getAttribute('uv');
  if (!attr || attr.count !== n) { attr = new THREE.BufferAttribute(new Float32Array(n * 2), 2); g.setAttribute('uv', attr); }
  cornerUVs(u.pm, T.charts, T.layout, b.cornerVertex, b.triFace, attr.array);
  attr.needsUpdate = true;
}
export function markTexDirty(obj) {
  const T = obj.userData.tex; if (!T) return;
  T.texture.needsUpdate = true; T.png = null; T.gen++; T.empty = false;
}

// ── 저장 / 불러오기 ──
export function texToJSON(obj) {
  const T = obj.userData.tex; if (!T || T.empty) return null;
  if (!T.png) { T.png = T.canvas.toDataURL('image/png').slice(PNG_PREFIX.length); remember(T.png, T.canvas); }
  return { s: T.layout.size, c: T.layout.cell, png: T.png };
}
export function loadTexFromJSON(obj, j) {
  if (!j || typeof j.png !== 'string') return null;
  const T = ensureTex(obj, makeLayout(j.s, j.c));
  T.empty = false; T.png = j.png;
  const cached = recall(j.png);
  if (cached && cached.width === T.canvas.width) { T.ctx.drawImage(cached, 0, 0); T.texture.needsUpdate = true; return T; }
  T.loading = true;
  const img = new Image(), gen = T.gen;
  img.onload = () => {
    if (obj.userData.tex !== T) return;
    T.loading = false;
    T.ctx.save(); T.ctx.globalCompositeOperation = T.gen === gen ? 'source-over' : 'destination-over';   // 그새 그린 게 있으면 그 밑에
    T.ctx.drawImage(img, 0, 0); T.ctx.restore();
    T.texture.needsUpdate = true;
    if (T.gen === gen) remember(j.png, T.canvas);
  };
  img.onerror = () => { T.loading = false; };
  img.src = PNG_PREFIX + j.png;
  return T;
}
// 옛 포맷(면마다 색 번호)을 그림으로: 면의 칸을 통째로 칠한다
export function bakeLegacyPaint(obj, paint) {
  if (!paint) return;
  const T = ensureTex(obj), cell = T.layout.cell;
  for (let fi = 0; fi < paint.f.length && fi < T.charts.length; fi++) {
    const k = paint.f[fi]; if (!k) continue;
    const ch = T.charts[fi];
    T.ctx.fillStyle = paint.pal[k - 1] || '#d9d9e3'; T.ctx.fillRect(ch.cx, ch.cy, cell, cell);
  }
  markTexDirty(obj);
}
// 다른 물체의 그림을 그대로 복사(복제·붙여넣기). 아직 불러오는 중이면 같은 PNG 를 다시 불러온다
export function copyTexFrom(dst, src) {
  const S = src.userData.tex; if (!S) return;
  if (S.loading && S.png) { loadTexFromJSON(dst, { s: S.layout.size, c: S.layout.cell, png: S.png }); return; }
  const T = ensureTex(dst, S.layout);
  T.ctx.drawImage(S.canvas, 0, 0);
  T.empty = S.empty; T.png = S.png; T.texture.needsUpdate = true;
}
// 지금 상태 스냅샷(위상을 바꾸기 전에 찍어 둔다). pm 을 주면 그 메시 기준(작업 시작 시점의 복사본)
export function snapshotTex(obj, pm = null) {
  const T = obj.userData.tex; if (!T) return null;
  const canvas = makeCanvas(T.canvas.width); canvas.getContext('2d').drawImage(T.canvas, 0, 0);
  const base = pm || obj.userData.pm;
  return { pm: base, layout: T.layout, charts: pm ? faceCharts(pm, T.layout) : T.charts, canvas, empty: T.empty, png: T.png };
}

// ── 위상이 바뀐 뒤 다시 굽기 ──
// obj.userData.pm/buffers/geometry 가 새 메시로 바뀐 다음 호출. base 는 snapshotTex 로 찍은 이전 상태.
// faceOrigin[새 면] = 원래 면(없으면 -1). 없으면 면 수가 같을 때 같은 번호, 다르면 가장 가까운 면. pointMap 은 새 좌표 → 원래 좌표(좌우 뒤집기).
export function rebakeTex(obj, { faceOrigin = null, base = null, pointMap = null } = {}) {
  const u = obj.userData, T = u.tex; if (!T) return;
  const pm = u.pm, n = pm.f.length;
  if (!layoutFits(T.layout, n)) { T.layout = chartLayout(n); if (T.canvas.width !== T.layout.size) T.canvas.width = T.canvas.height = T.layout.size; }
  refreshCharts(obj);
  const ctx = T.ctx, L = T.layout, cell = L.cell, size = L.size;
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, size, size);
  if (!base) { ctx.restore(); markTexDirty(obj); return; }
  const same = sameLayout(L, base.layout) && base.canvas.width === size;
  if (same) ctx.drawImage(base.canvas, 0, 0);
  let origin = faceOrigin;
  if (!origin && (base.pm.f.length !== n || pointMap)) origin = nearestFaces(base.pm, pm);
  let srcData = null, cellData = null;
  const M = base.pm.f.length;
  for (let fi = 0; fi < n; fi++) {
    const o = origin ? origin[fi] : fi, dst = T.charts[fi];
    if (!(o >= 0 && o < M)) { if (same) ctx.clearRect(dst.cx, dst.cy, cell, cell); continue; }
    const src = base.charts[o];
    if (same && o === fi && !pointMap && sameChart(dst, src)) continue;   // 그대로인 면
    const m = chartAffine(dst, src, pointMap), inv = invertAffine(m);
    ctx.clearRect(dst.cx, dst.cy, cell, cell);
    if (inv) {
      // 새 칸이 원래 그림의 어느 부분을 쓰는지(네 귀퉁이의 상) 만큼만 가져온다
      const c = [applyAffine(m, dst.cx, dst.cy), applyAffine(m, dst.cx + cell, dst.cy), applyAffine(m, dst.cx, dst.cy + cell), applyAffine(m, dst.cx + cell, dst.cy + cell)];
      const sx0 = Math.max(0, Math.floor(Math.min(c[0][0], c[1][0], c[2][0], c[3][0]) - 1)), sy0 = Math.max(0, Math.floor(Math.min(c[0][1], c[1][1], c[2][1], c[3][1]) - 1));
      const sx1 = Math.min(base.canvas.width, Math.ceil(Math.max(c[0][0], c[1][0], c[2][0], c[3][0]) + 1)), sy1 = Math.min(base.canvas.height, Math.ceil(Math.max(c[0][1], c[1][1], c[2][1], c[3][1]) + 1));
      if (sx1 <= sx0 || sy1 <= sy0) continue;
      ctx.save(); ctx.beginPath(); ctx.rect(dst.cx, dst.cy, cell, cell); ctx.clip();
      ctx.setTransform(inv.a, inv.b, inv.c, inv.d, inv.e, inv.f);
      ctx.drawImage(base.canvas, sx0, sy0, sx1 - sx0, sy1 - sy0, sx0, sy0, sx1 - sx0, sy1 - sy0);
      ctx.restore();
    } else {
      // 원래 면과 직각인 새 면(밀어내기 옆면 등): 선 위로 눌려 붙으므로 픽셀마다 가장 가까운 원래 픽셀을 가져온다
      if (!srcData) srcData = base.canvas.getContext('2d').getImageData(0, 0, base.canvas.width, base.canvas.height);
      if (!cellData) cellData = ctx.createImageData(cell, cell);
      const W = base.canvas.width, sd = srcData.data, cd = cellData.data;
      const x0 = src.cx, x1 = src.cx + cell - 1, y0 = src.cy, y1 = src.cy + cell - 1;
      for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) {
        const [sx, sy] = applyAffine(m, dst.cx + x + 0.5, dst.cy + y + 0.5);
        const ix = Math.min(x1, Math.max(x0, Math.round(sx - 0.5))), iy = Math.min(y1, Math.max(y0, Math.round(sy - 0.5)));
        const si = (iy * W + ix) * 4, di = (y * cell + x) * 4;
        cd[di] = sd[si]; cd[di + 1] = sd[si + 1]; cd[di + 2] = sd[si + 2]; cd[di + 3] = sd[si + 3];
      }
      ctx.putImageData(cellData, dst.cx, dst.cy);
    }
  }
  if (same) for (let fi = n; fi < Math.min(M, L.cap); fi++) { const cx = (fi % L.cols) * cell, cy = Math.floor(fi / L.cols) * cell; ctx.clearRect(cx, cy, cell, cell); }
  ctx.restore();
  T.empty = base.empty;
  markTexDirty(obj);
}

// ── 붓 ──
// 한 번 긋기 동안 쓰는 면 정보(로컬 좌표): 중심, 중심에서 꼭짓점까지 최대 거리, 법선
export function strokeInfo(obj) {
  const pm = obj.userData.pm, n = pm.f.length, centers = new Float32Array(n * 3), radii = new Float32Array(n), normals = new Float32Array(n * 3);
  for (let fi = 0; fi < n; fi++) {
    const c = pmFaceCenter(pm, fi); centers.set(c, fi * 3); normals.set(pmFaceNormal(pm, fi), fi * 3);
    let r = 0; for (const vi of pm.f[fi]) { const p = pm.v[vi]; const d = Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]); if (d > r) r = d; }
    radii[fi] = r;
  }
  return { centers, radii, normals };
}
// 붓 한 번: 반지름 r(로컬)의 공이 닿는 면마다, 면 평면과 공이 만나는 원을 찍는다(모서리를 넘어 옆면으로 자연스럽게 이어진다). 뒷면은 안 칠한다.
// color '#rrggbb' / erase 면 지우개. hardness 0~1: 가장자리를 얼마나 또렷하게. 그린 게 있으면 true
export function dab(obj, info, p, nrm, r, { color = '#000000', erase = false, hardness = 0.6 } = {}) {
  const T = obj.userData.tex; if (!T) return false;
  const charts = T.charts, cell = T.layout.cell, ctx = T.ctx, { centers: C, radii: R, normals: N } = info, n = charts.length, r2 = r * r;
  let any = false;
  for (let fi = 0; fi < n; fi++) {
    const dx = C[fi * 3] - p[0], dy = C[fi * 3 + 1] - p[1], dz = C[fi * 3 + 2] - p[2];
    if (Math.sqrt(dx * dx + dy * dy + dz * dz) > r + R[fi]) continue;
    if (N[fi * 3] * nrm[0] + N[fi * 3 + 1] * nrm[1] + N[fi * 3 + 2] * nrm[2] < -0.25) continue;
    const ch = charts[fi], h = chartHeight(ch, p);
    if (h * h >= r2) continue;
    const rp = Math.max(0.6, Math.sqrt(r2 - h * h) * ch.scale);
    const [x, y] = chartPixel(ch, p);
    if (x + rp < ch.cx || x - rp > ch.cx + cell || y + rp < ch.cy || y - rp > ch.cy + cell) continue;
    const inside = x - rp >= ch.cx && x + rp <= ch.cx + cell && y - rp >= ch.cy && y + rp <= ch.cy + cell;
    ctx.save();
    if (!inside) { ctx.beginPath(); ctx.rect(ch.cx, ch.cy, cell, cell); ctx.clip(); }
    ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
    if (rp > 2 && hardness < 1) {
      const g = ctx.createRadialGradient(x, y, rp * hardness, x, y, rp);
      g.addColorStop(0, erase ? 'rgba(0,0,0,1)' : color); g.addColorStop(1, erase ? 'rgba(0,0,0,0)' : `${color}00`);
      ctx.fillStyle = g;
    } else ctx.fillStyle = erase ? '#000000' : color;
    ctx.beginPath(); ctx.arc(x, y, rp, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    any = true;
  }
  if (any) markTexDirty(obj);
  return any;
}
// 면 단위: 면의 칸을 통째로 칠하거나(color) 지운다(null)
export function fillFace(obj, fi, color) {
  const T = obj.userData.tex; if (!T || !T.charts[fi]) return false;
  const ch = T.charts[fi], cell = T.layout.cell, ctx = T.ctx;
  ctx.save(); ctx.globalCompositeOperation = 'source-over';
  if (color) { ctx.fillStyle = color; ctx.fillRect(ch.cx, ch.cy, cell, cell); } else ctx.clearRect(ch.cx, ch.cy, cell, cell);
  ctx.restore();
  markTexDirty(obj);
  return true;
}

// 내보내기용: 물체 색 위에 붓 자국을 얹은 불투명 PNG(바이트). 캔버스가 없으면(앨범 JSON) PNG 를 먼저 그림으로 읽는다
export async function compositeTexPNG(texJson, baseColor) {
  const size = texJson.s, canvas = makeCanvas(size), ctx = canvas.getContext('2d');
  ctx.fillStyle = baseColor || '#d9d9e3'; ctx.fillRect(0, 0, size, size);
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = PNG_PREFIX + texJson.png; });
  ctx.drawImage(img, 0, 0);
  const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}
