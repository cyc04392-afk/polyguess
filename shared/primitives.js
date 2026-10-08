// 기본 도형 14종을 다각형 메시(polymesh.js 규격)로 만든다 — 렌더러 무관(순수 JS).
// 모든 도형은 닫힌 메시, 면은 바깥에서 봤을 때 반시계(CCW), 원점이 중심, Y축이 위.
// 치수는 예전 Three.js 지오메트리와 같다(상자 1·공 r0.5·원기둥 r0.5 h1·도넛 R0.4 r0.15·캡슐 r0.3 l0.6·판 1×0.12×1·피라미드 밑변≈0.99 h1·
// 반구 r0.5·세모기둥 r0.6·육각기둥 r0.55·별 r0.5/0.22 두께0.3·하트 두께0.3·찰흙 r0.6). hd=true 는 찰흙용 촘촘한 버전.

export const PRIMITIVE_KINDS = ['box', 'sphere', 'cylinder', 'cone', 'torus', 'capsule', 'slab', 'pyramid', 'hemisphere', 'prism3', 'prism6', 'star', 'heart', 'clay'];

const TAU = Math.PI * 2;

// 같은 자리 정점 합치기 + 찌그러진 면 정리
function weld(v, f, eps = 1e-6) {
  const q = 1 / eps, map = new Map(), nv = [], remap = new Array(v.length);
  v.forEach((p, i) => {
    const key = `${Math.round(p[0] * q)},${Math.round(p[1] * q)},${Math.round(p[2] * q)}`;
    let id = map.get(key);
    if (id === undefined) { id = nv.length; map.set(key, id); nv.push([p[0], p[1], p[2]]); }
    remap[i] = id;
  });
  const nf = [];
  for (const face of f) {
    const out = [];
    for (const vi of face) { const r = remap[vi]; if (out[out.length - 1] !== r) out.push(r); }
    while (out.length > 1 && out[0] === out[out.length - 1]) out.pop();
    if (out.length >= 3) nf.push(out);
  }
  return { v: nv, f: nf };
}

// 평면 격자 한 장: origin 에서 u 방향 nu 칸, v 방향 nv 칸. 바깥 방향 = u × v
function gridFace(out, origin, u, w, nu, nw) {
  const base = out.v.length;
  for (let j = 0; j <= nw; j++) for (let i = 0; i <= nu; i++) {
    const s = i / nu, t = j / nw;
    out.v.push([origin[0] + u[0] * s + w[0] * t, origin[1] + u[1] * s + w[1] * t, origin[2] + u[2] * s + w[2] * t]);
  }
  const at = (i, j) => base + j * (nu + 1) + i;
  for (let j = 0; j < nw; j++) for (let i = 0; i < nu; i++) out.f.push([at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)]);
}

export function makeBox(w = 1, h = 1, d = 1, sx = 1, sy = 1, sz = 1) {
  const out = { v: [], f: [] }, X = w / 2, Y = h / 2, Z = d / 2;
  gridFace(out, [X, -Y, -Z], [0, h, 0], [0, 0, d], sy, sz);   // +X : y × z
  gridFace(out, [-X, -Y, -Z], [0, 0, d], [0, h, 0], sz, sy);  // -X : z × y
  gridFace(out, [-X, Y, -Z], [0, 0, d], [w, 0, 0], sz, sx);   // +Y : z × x
  gridFace(out, [-X, -Y, -Z], [w, 0, 0], [0, 0, d], sx, sz);  // -Y : x × z
  gridFace(out, [-X, -Y, Z], [w, 0, 0], [0, h, 0], sx, sy);   // +Z : x × y
  gridFace(out, [-X, -Y, -Z], [0, h, 0], [w, 0, 0], sy, sx);  // -Z : y × x
  return weld(out.v, out.f);
}

// 회전체. profile = [[r, y], ...] 아래→위 순서. r=0 인 점은 꼭짓점(극점) 하나가 된다.
// caps: 'ngon'(한 면) | 'fan'(가운데 점 + 삼각형) | 'none'. 양 끝 점의 r>0 이면 뚜껑을 덮는다.
export function lathe(profile, segments, { caps = 'ngon', thetaOffset = 0 } = {}) {
  const v = [], f = [], rings = [];
  for (const [r, y] of profile) {
    if (r <= 1e-9) { rings.push({ pole: v.length }); v.push([0, y, 0]); continue; }
    const start = v.length;
    for (let j = 0; j < segments; j++) { const a = thetaOffset + (j / segments) * TAU; v.push([r * Math.sin(a), y, r * Math.cos(a)]); }
    rings.push({ start });
  }
  const at = (ring, j) => ring.start + (j % segments);
  for (let i = 0; i + 1 < rings.length; i++) {
    const lo = rings[i], hi = rings[i + 1];
    if (lo.pole !== undefined && hi.pole !== undefined) continue;
    for (let j = 0; j < segments; j++) {
      if (lo.pole !== undefined) f.push([lo.pole, at(hi, j + 1), at(hi, j)]);
      else if (hi.pole !== undefined) f.push([at(lo, j), at(lo, j + 1), hi.pole]);
      else f.push([at(lo, j), at(lo, j + 1), at(hi, j + 1), at(hi, j)]);
    }
  }
  const cap = (ring, top) => {
    if (caps === 'none' || ring.pole !== undefined) return;
    if (caps === 'fan') {
      const c = v.length; v.push([0, v[ring.start][1], 0]);
      for (let j = 0; j < segments; j++) f.push(top ? [at(ring, j), at(ring, j + 1), c] : [c, at(ring, j + 1), at(ring, j)]);
    } else {
      const face = []; for (let j = 0; j < segments; j++) face.push(at(ring, j));
      f.push(top ? face : face.reverse());
    }
  };
  cap(rings[0], false);
  cap(rings[rings.length - 1], true);
  return { v, f };
}

// 원호 프로필 도우미: 각도 a0→a1(라디안, 0=옆, π/2=위)을 n 칸으로. 중심 (0, cy), 반지름 r
function arc(r, cy, a0, a1, n) {
  const pts = [];
  for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; pts.push([Math.max(0, r * Math.cos(a)), cy + r * Math.sin(a)]); }
  return pts;
}

export function makeSphere(r = 0.5, widthSeg = 32, heightSeg = 20) {
  return lathe(arc(r, 0, -Math.PI / 2, Math.PI / 2, heightSeg), widthSeg);
}
export function makeCylinder(r = 0.5, h = 1, radial = 32, heightSeg = 1, caps = 'ngon', thetaOffset = 0) {
  const prof = []; for (let i = 0; i <= heightSeg; i++) prof.push([r, -h / 2 + (h * i) / heightSeg]);
  return lathe(prof, radial, { caps, thetaOffset });
}
export function makeCone(r = 0.5, h = 1, radial = 32, heightSeg = 1, caps = 'ngon', thetaOffset = 0) {
  const prof = []; for (let i = 0; i <= heightSeg; i++) prof.push([r * (1 - i / heightSeg), -h / 2 + (h * i) / heightSeg]);
  return lathe(prof, radial, { caps, thetaOffset });
}
export function makeHemisphere(r = 0.5, radial = 32, heightSeg = 16, caps = 'ngon') {
  // 돔 + 평평한 바닥. 전체 높이 r 을 가운데 맞춤 → y ∈ [-r/2, r/2]
  return lathe(arc(r, -r / 2, 0, Math.PI / 2, heightSeg), radial, { caps });
}
export function makeCapsule(r = 0.3, len = 0.6, capSeg = 6, radial = 16) {
  const prof = [...arc(r, -len / 2, -Math.PI / 2, 0, capSeg), ...arc(r, len / 2, 0, Math.PI / 2, capSeg)];
  return lathe(prof, radial);
}
export function makeTorus(R = 0.4, r = 0.15, radialSeg = 14, tubularSeg = 36) {
  const v = [], f = [];
  for (let j = 0; j < tubularSeg; j++) {
    const th = (j / tubularSeg) * TAU, sx = Math.sin(th), cz = Math.cos(th);
    for (let k = 0; k < radialSeg; k++) {
      const ph = (k / radialSeg) * TAU, rr = R + r * Math.cos(ph);
      v.push([rr * sx, r * Math.sin(ph), rr * cz]);
    }
  }
  const at = (j, k) => ((j % tubularSeg) * radialSeg) + (k % radialSeg);
  for (let j = 0; j < tubularSeg; j++) for (let k = 0; k < radialSeg; k++) f.push([at(j, k), at(j + 1, k), at(j + 1, k + 1), at(j, k + 1)]);
  return { v, f };
}

// 2D 다각형(xy 평면, CCW) 을 z 방향으로 두께 depth 만큼 뽑아 가운데 맞춤
export function extrudePolygon(points, depth) {
  let area = 0;
  for (let i = 0; i < points.length; i++) { const p = points[i], q = points[(i + 1) % points.length]; area += p[0] * q[1] - q[0] * p[1]; }
  const pts = area < 0 ? points.slice().reverse() : points;
  const n = pts.length, hz = depth / 2, v = [], f = [];
  for (const [x, y] of pts) v.push([x, y, hz]);   // 앞면 0..n-1
  for (const [x, y] of pts) v.push([x, y, -hz]);  // 뒷면 n..2n-1
  f.push(pts.map((_, i) => i));                   // 앞면(+z) CCW
  f.push(pts.map((_, i) => n + (n - 1 - i)));     // 뒷면(-z) 뒤집어서
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; f.push([i, n + i, n + j, j]); }
  return { v, f };
}
export function starPoints(outer = 0.5, inner = 0.22) {
  const pts = [];
  for (let i = 0; i < 10; i++) { const r = i % 2 ? inner : outer, a = Math.PI / 2 + (i * Math.PI) / 5; pts.push([Math.cos(a) * r, Math.sin(a) * r]); }
  return pts;
}
function bezier(p0, p1, p2, p3, steps, out) {
  for (let i = 1; i <= steps; i++) {
    const t = i / steps, u = 1 - t;
    out.push([u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]]);
  }
}
export function heartPoints(steps = 10) {
  const pts = [[0, -0.45]];
  bezier([0, -0.45], [0, -0.45], [-0.55, -0.1], [-0.55, 0.15], steps, pts);
  bezier([-0.55, 0.15], [-0.55, 0.45], [-0.25, 0.5], [0, 0.3], steps, pts);
  bezier([0, 0.3], [0.25, 0.5], [0.55, 0.45], [0.55, 0.15], steps, pts);
  bezier([0.55, 0.15], [0.55, -0.1], [0, -0.45], [0, -0.45], steps, pts);
  // 끝점이 시작점과 같으므로 하나 제거, 너무 가까운 점도 제거
  const out = [];
  for (const p of pts) { const q = out[out.length - 1]; if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-4) out.push(p); }
  while (out.length > 1 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) < 1e-4) out.pop();
  return out;
}
// 사각형을 공처럼 부풀린 "쿼드 스피어"(찰흙 덩어리). 면이 전부 사각형이라 다듬기 좋다.
export function makeQuadSphere(r = 0.6, seg = 12) {
  const box = makeBox(2, 2, 2, seg, seg, seg);
  for (const p of box.v) {
    // 격자가 고르게 퍼지도록 tan 보정 뒤 정규화
    const t = p.map(x => Math.tan((x * Math.PI) / 4));
    const l = Math.hypot(t[0], t[1], t[2]) || 1;
    p[0] = (t[0] / l) * r; p[1] = (t[1] / l) * r; p[2] = (t[2] / l) * r;
  }
  return box;
}

export function makePrimitive(kind, hd = false) {
  switch (kind) {
    case 'sphere': return makeSphere(0.5, hd ? 64 : 32, hd ? 40 : 20);
    case 'cylinder': return makeCylinder(0.5, 1, hd ? 64 : 32, hd ? 20 : 1, hd ? 'fan' : 'ngon');
    case 'cone': return makeCone(0.5, 1, hd ? 64 : 32, hd ? 20 : 1, hd ? 'fan' : 'ngon');
    case 'torus': return makeTorus(0.4, 0.15, hd ? 32 : 14, hd ? 96 : 36);
    case 'capsule': return makeCapsule(0.3, 0.6, hd ? 24 : 6, hd ? 48 : 16);
    case 'slab': return makeBox(1, 0.12, 1, hd ? 20 : 1, hd ? 3 : 1, hd ? 20 : 1);
    case 'pyramid': return makeCone(0.7, 1, 4, hd ? 16 : 1, hd ? 'fan' : 'ngon', Math.PI / 4);
    case 'hemisphere': return makeHemisphere(0.5, hd ? 64 : 32, hd ? 32 : 16, hd ? 'fan' : 'ngon');
    case 'prism3': return makeCylinder(0.6, 1, 3, hd ? 16 : 1, hd ? 'fan' : 'ngon');
    case 'prism6': return makeCylinder(0.55, 1, 6, hd ? 16 : 1, hd ? 'fan' : 'ngon');
    case 'star': return extrudePolygon(starPoints(), 0.3);
    case 'heart': return extrudePolygon(heartPoints(hd ? 24 : 10), 0.3);
    case 'clay': return makeQuadSphere(0.6, hd ? 24 : 12);
    case 'box': default: return makeBox(1, 1, 1, hd ? 20 : 1, hd ? 20 : 1, hd ? 20 : 1);
  }
}
