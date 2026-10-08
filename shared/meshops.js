// 다각형 메시 편집 연산 — 렌더러 무관(순수 JS). 모두 새 메시를 돌려주고 입력은 바꾸지 않는다.
// edgeRing(루프 자르기용 한 바퀴) · edgeLoop(선 한 바퀴 선택) · loopCut · bevelEdges · extrudeFaces · deleteFaces · edgesOfSelection
// 유니티 등으로 옮길 때 같은 결과를 내야 하는 규격이다(docs/PROTOCOL.md 4절).
import { edgeKey, pmEdges, pmFaceNormal, clonePolyMesh } from './polymesh.js';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = a => Math.hypot(a[0], a[1], a[2]);
const norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// 면 안에서 (a→b) 방향으로 들어 있는 모서리의 자리(k: face[k]=a, face[k+1]=b). 없으면 -1
function orientedPos(face, a, b) { for (let k = 0; k < face.length; k++) if (face[k] === a && face[(k + 1) % face.length] === b) return k; return -1; }

// 쓰이지 않는 정점 제거(번호 다시 매김)
export function compactPolyMesh(pm) {
  const used = new Uint8Array(pm.v.length);
  for (const face of pm.f) for (const vi of face) used[vi] = 1;
  const remap = new Int32Array(pm.v.length).fill(-1), v = [];
  for (let i = 0; i < pm.v.length; i++) if (used[i]) { remap[i] = v.length; v.push(pm.v[i]); }
  return { v, f: pm.f.map(face => face.map(vi => remap[vi])) };
}

// ── 루프 자르기용 모서리 링: 사각형 면을 가로질러 반대편 모서리로 계속 간다 ──
// 돌려주는 값: { edges:[{ei,a,b}], faces:[fi], closed }  — edges[j] 와 edges[j+1] 사이가 faces[j]. a/b 쪽이 일관되게 정렬됨.
export function edgeRing(pm, E, ei) {
  const list = E.list, e0 = list[ei];
  if (!e0) return null;
  // (a,b) 모서리에서 사각형 fi 를 건너 반대편 모서리로
  const step = (fi, a, b) => {
    const face = pm.f[fi];
    if (face.length !== 4) return null;
    const ia = face.indexOf(a), ib = face.indexOf(b);
    if (ia < 0 || ib < 0) return null;
    const pa = face[(ia + 3) % 4], na = face[(ia + 1) % 4], a2 = pa === b ? na : pa;
    const pb = face[(ib + 3) % 4], nb = face[(ib + 1) % 4], b2 = pb === a ? nb : pb;
    const ei2 = E.index.get(edgeKey(a2, b2));
    if (ei2 === undefined) return null;
    return { ei: ei2, a: a2, b: b2 };
  };
  const seen = new Set([ei]);
  let closed = false;
  const walk = (startFace) => {
    const edges = [], faces = [];
    let cur = { ei, a: e0.a, b: e0.b }, fi = startFace;
    while (fi !== undefined) {
      const nx = step(fi, cur.a, cur.b);
      if (!nx) break;
      if (nx.ei === ei) { closed = true; faces.push(fi); break; }
      if (seen.has(nx.ei)) break;
      seen.add(nx.ei);
      faces.push(fi); edges.push(nx);
      cur = nx;
      const fs = list[nx.ei].faces;
      fi = fs.length === 2 ? fs.find(x => x !== fi) : undefined;
    }
    return { edges, faces };
  };
  const fwd = walk(e0.faces[0]);
  if (closed) return { edges: [{ ei, a: e0.a, b: e0.b }, ...fwd.edges], faces: fwd.faces, closed: true };
  const bwd = e0.faces.length === 2 ? walk(e0.faces[1]) : { edges: [], faces: [] };
  return { edges: [...bwd.edges.reverse(), { ei, a: e0.a, b: e0.b }, ...fwd.edges], faces: [...bwd.faces.reverse(), ...fwd.faces], closed: false };
}

// ── 선 한 바퀴(엣지 루프) 선택: 꼭짓점에서 면을 공유하지 않는 맞은편 모서리로 이어 간다(차수 4 인 꼭짓점만) ──
export function edgeLoop(pm, E, ei) {
  const list = E.list;
  if (!list[ei]) return [];
  const vedges = pm.v.map(() => []);
  list.forEach((e, i) => { vedges[e.a].push(i); vedges[e.b].push(i); });
  const nextEdge = (cur, v) => {
    const e = list[cur];
    // n각형(뚜껑 등)이나 열린 가장자리를 따라가는 모서리는 그 테두리를 계속 따라간다
    const big = e.faces.find(f => pm.f[f].length > 4);
    if (big !== undefined || e.faces.length === 1) {
      const c = vedges[v].filter(x => x !== cur && (big !== undefined ? list[x].faces.includes(big) : list[x].faces.length === 1));
      return c.length === 1 ? c[0] : -1;
    }
    if (vedges[v].length !== 4) return -1;
    const fs = new Set(e.faces);
    const c = vedges[v].filter(x => x !== cur && !list[x].faces.some(f => fs.has(f)));
    return c.length === 1 ? c[0] : -1;
  };
  const out = [ei], seen = new Set([ei]);
  for (const start of [list[ei].b, list[ei].a]) {
    let cur = ei, v = start;
    for (let guard = 0; guard < list.length; guard++) {
      const nx = nextEdge(cur, v);
      if (nx < 0 || seen.has(nx)) break;
      seen.add(nx); out.push(nx);
      v = list[nx].a === v ? list[nx].b : list[nx].a; cur = nx;
    }
  }
  return out;
}

// 자르는 위치들(0~1). slide 로 전체를 한쪽으로 민다
export function loopCutParams(cuts, slide = 0) {
  const n = Math.max(1, Math.round(cuts)), out = [];
  for (let k = 0; k < n; k++) { let t = (k + 1) / (n + 1); t = slide > 0 ? t + slide * (1 - t) : t + slide * t; out.push(t); }
  return out;
}

// ── 루프 자르기: 링의 모서리마다 cuts 개의 새 정점을 만들고 사각형들을 잘게 나눈다 ──
// 돌려주는 값: { pm, verts: verts[k][j] = k번째 자름 · j번째 링 모서리의 새 정점, edges:[[a,b]...] 새로 생긴 자른 선 }
// 기존 정점 번호는 그대로 유지된다.
export function loopCut(pm, ring, cuts, slide = 0) {
  if (!ring || !ring.edges.length) return { pm: clonePolyMesh(pm), verts: [], edges: [] };
  const out = clonePolyMesh(pm);
  const ts = loopCutParams(cuts, slide), n = ts.length, m = ring.edges.length;
  const verts = ts.map(() => []);
  ring.edges.forEach(({ a, b }, j) => { for (let k = 0; k < n; k++) { verts[k][j] = out.v.length; out.v.push(lerp3(pm.v[a], pm.v[b], ts[k])); } });
  const ringFaces = new Set(ring.faces);
  const jOfEdge = new Map(); ring.edges.forEach((e, j) => jOfEdge.set(edgeKey(e.a, e.b), j));
  const nf = [];
  // 링에 속하지 않는 면이 링 모서리를 갖고 있으면(열린 링의 양 끝 바깥 면, n각형 등) 새 정점을 끼워 넣는다
  for (let fi = 0; fi < pm.f.length; fi++) {
    if (ringFaces.has(fi)) continue;
    const face = pm.f[fi], res = [];
    for (let k = 0; k < face.length; k++) {
      const u = face[k], w = face[(k + 1) % face.length];
      res.push(u);
      const j = jOfEdge.get(edgeKey(u, w));
      if (j !== undefined) { const seq = verts.map(row => row[j]); res.push(...(u === ring.edges[j].a ? seq : seq.slice().reverse())); }
    }
    nf.push(res);
  }
  // 링 면: cuts+1 개의 사각형으로
  ring.faces.forEach((fi, j) => {
    const face = pm.f[fi], eA = ring.edges[j], eB = ring.edges[(j + 1) % m];
    const ia = face.indexOf(eA.a);
    const rot = [0, 1, 2, 3].map(k => face[(ia + k) % 4]);
    const P = verts.map(row => row[j]), Q = verts.map(row => row[(j + 1) % m]);
    const seqA = [eA.a, ...P, eA.b], seqB = [eB.a, ...Q, eB.b];
    if (rot[1] === eA.b) for (let k = 0; k <= n; k++) nf.push([seqA[k], seqA[k + 1], seqB[k + 1], seqB[k]]);   // [a, b, b', a']
    else for (let k = 0; k <= n; k++) nf.push([seqA[k], seqB[k], seqB[k + 1], seqA[k + 1]]);                   // [a, a', b', b]
  });
  out.f = nf;
  const edges = [];
  for (let k = 0; k < n; k++) for (let j = 0; j < ring.faces.length; j++) edges.push([verts[k][j], verts[k][(j + 1) % m]]);
  return { pm: out, verts, edges };
}

// ── 베벨: 고른 모서리를 깎아 띠(segments 개의 사각형)로 바꾸고, 모서리가 만나는 꼭짓점에는 메움 면을 만든다 ──
// 돌려주는 값: { pm, faces: 새로 생긴 띠·메움 면 번호 }
export function bevelEdges(pm, E, edgeIds, { width = 0.1, segments = 1 } = {}) {
  const list = E.list;
  const bev = new Set();
  for (const ei of edgeIds || []) if (list[ei] && list[ei].faces.length === 2) bev.add(ei);
  const seg = Math.max(1, Math.round(segments));
  if (!bev.size || !(width > 0)) return { pm: clonePolyMesh(pm), faces: [] };
  const V = pm.v;
  const out = { v: V.map(p => [p[0], p[1], p[2]]), f: [] };
  const isBev = (a, b) => { const ei = E.index.get(edgeKey(a, b)); return ei !== undefined && bev.has(ei); };
  const cornerV = pm.f.map(face => face.slice());   // (면, 자리) → 그 모퉁이를 대신하는 정점
  const edgePoint = new Map();                       // `${edgeKey}:${v}` → 깎이지 않은 모서리 위, v 쪽 끝의 옮겨진 점
  const splitT = new Map();                          // 정점 번호 → 그 모서리(list.a 기준) 위 매개변수 t
  const splits = new Map();                          // edgeKey → [정점 번호…]

  pm.f.forEach((face, fi) => {
    const n = face.length;
    for (let k = 0; k < n; k++) {
      const v = face[k], prev = face[(k + n - 1) % n], next = face[(k + 1) % n];
      const bp = isBev(prev, v), bn = isBev(v, next);
      if (!bp && !bn) continue;
      const P = V[v], dp = sub(V[prev], P), dn = sub(V[next], P), Lp = len(dp), Ln = len(dn);
      const up = scale(dp, 1 / (Lp || 1)), un = scale(dn, 1 / (Ln || 1));
      const cosT = Math.max(-1, Math.min(1, dot(up, un))), theta = Math.acos(cosT);
      if (bp && bn) {
        let b = add(up, un);
        if (len(b) < 1e-9) { b = norm(cross(pmFaceNormal(pm, fi), un)); }   // 일직선(180°)이면 면 안쪽으로
        b = norm(b);
        let d = width / Math.max(1e-6, Math.sin(theta / 2));
        const proj = d * Math.cos(theta / 2), maxProj = 0.45 * Math.min(Lp, Ln);
        if (proj > maxProj) d *= maxProj / proj;
        cornerV[fi][k] = out.v.length; out.v.push(add(P, scale(b, d)));
      } else {
        const other = bn ? prev : next, u = bn ? up : un, L = bn ? Lp : Ln;
        const ek = edgeKey(v, other), key = `${ek}:${v}`;
        let vi = edgePoint.get(key);
        if (vi === undefined) {
          const d = Math.min(width / Math.max(1e-6, Math.sin(theta)), 0.45 * L);
          vi = out.v.length; out.v.push(add(P, scale(u, d)));
          edgePoint.set(key, vi);
          const e = list[E.index.get(ek)];
          splitT.set(vi, e.a === v ? d / L : 1 - d / L);
          if (!splits.has(ek)) splits.set(ek, []); splits.get(ek).push(vi);
        }
        cornerV[fi][k] = vi;
      }
    }
  });

  // 깎이지 않은 두 모서리 모두에 (이 꼭짓점 쪽) 옮겨진 점이 있는 모퉁이는 꼭짓점 자체가 사라진다
  // (상자 모서리 하나만 깎을 때 양 끝 면이 5각형이 되는 경우)
  const DROP = -1;
  pm.f.forEach((face, fi) => {
    const n = face.length;
    for (let k = 0; k < n; k++) {
      const v = face[k];
      if (cornerV[fi][k] !== v) continue;
      const prev = face[(k + n - 1) % n], next = face[(k + 1) % n];
      if (edgePoint.has(`${edgeKey(prev, v)}:${v}`) && edgePoint.has(`${edgeKey(v, next)}:${v}`)) cornerV[fi][k] = DROP;
    }
  });

  // 원래 면 자리를 먼저 비워 둔다(번호 유지). 띠·메움 면은 그 뒤에 붙는다
  out.f = pm.f.map(() => null);
  // 띠: 깎은 모서리마다 양쪽 면의 안쪽 선을 잇는다. 프로필은 원래 모서리를 중심으로 한 원호 느낌
  const newFaces = [];
  const prof = new Map();        // `${ei}:${v}` → [fAB 쪽 점 … fBA 쪽 점]
  const shared = new Map();      // `${v}:${c1}:${c2}` → 같은 두 모퉁이 점 사이의 프로필(이웃한 깎인 모서리끼리 공유)
  const sideAB = new Map();      // ei → a→b 방향으로 모서리를 가진 면
  for (const ei of bev) {
    const e = list[ei], [f1, f2] = e.faces;
    const fAB = orientedPos(pm.f[f1], e.a, e.b) >= 0 ? f1 : f2, fBA = fAB === f1 ? f2 : f1;
    sideAB.set(ei, fAB);
    const corner = (fi, v) => cornerV[fi][pm.f[fi].indexOf(v)];
    const profile = v => {
      const c1 = corner(fAB, v), c2 = corner(fBA, v);
      if (c1 === c2 || c1 === DROP || c2 === DROP) return [c1 === DROP ? c2 : c1];
      const key = `${v}:${Math.min(c1, c2)}:${Math.max(c1, c2)}`;
      const got = shared.get(key);
      if (got) return got[0] === c1 ? got : got.slice().reverse();
      const pts = [c1], P = V[v], d1 = sub(out.v[c1], P), d2 = sub(out.v[c2], P);
      for (let k = 1; k < seg; k++) { const a = (k / seg) * Math.PI / 2; pts.push(out.v.length); out.v.push(add(P, add(scale(d1, Math.cos(a)), scale(d2, Math.sin(a))))); }
      pts.push(c2);
      shared.set(key, pts);
      return pts;
    };
    const Pa = profile(e.a), Pb = profile(e.b);
    prof.set(`${ei}:${e.a}`, Pa); prof.set(`${ei}:${e.b}`, Pb);
    for (let k = 0; k < seg; k++) {
      const q = dedupeLoop([Pb[Math.min(k, Pb.length - 1)], Pa[Math.min(k, Pa.length - 1)], Pa[Math.min(k + 1, Pa.length - 1)], Pb[Math.min(k + 1, Pb.length - 1)]]);
      if (q.length >= 3) { newFaces.push(out.f.length); out.f.push(q); }
    }
  }

  // 꼭짓점 메움: 깎인 모서리가 닿는 꼭짓점마다, 그 둘레 면들의 모퉁이 점들을 한 바퀴 이어 면을 만든다
  const touched = new Set();
  for (const ei of bev) { touched.add(list[ei].a); touched.add(list[ei].b); }
  const vfaces = pm.v.map(() => []);
  pm.f.forEach((face, fi) => { for (const vi of face) vfaces[vi].push(fi); });
  const absorb = new Map();      // `${fi}:${k}` → DROP 모퉁이가 대신 품는 점들(구멍 둘레)
  for (const v of touched) {
    const fs = vfaces[v]; if (!fs.length) continue;
    const start = fs[0]; let fi = start; const poly = [], drops = []; let ok = true;
    for (let guard = 0; guard <= fs.length; guard++) {
      const face = pm.f[fi], k = face.indexOf(v), prev = face[(k + face.length - 1) % face.length];
      if (cornerV[fi][k] !== DROP) poly.push(cornerV[fi][k]); else drops.push({ fi, k, at: poly.length });
      const ei = E.index.get(edgeKey(prev, v)), e = list[ei];
      if (!e || e.faces.length !== 2) { ok = false; break; }   // 열린 가장자리: 메우지 않는다
      if (bev.has(ei)) {
        const p = prof.get(`${ei}:${v}`), inner = p.slice(1, -1);
        poly.push(...(sideAB.get(ei) === fi ? inner : inner.reverse()));
      }
      const nx = e.faces[0] === fi ? e.faces[1] : e.faces[0];
      if (nx === start) break;
      if (guard === fs.length) { ok = false; break; }
      fi = nx;
    }
    if (!ok) continue;
    if (drops.length === 1) {   // 꼭짓점이 사라진 면이 구멍 둘레를 그대로 자기 테두리로 삼는다(상자 모서리 하나 깎기의 5각형)
      const { fi: dfi, k: dk, at } = drops[0];
      absorb.set(`${dfi}:${dk}`, [...poly.slice(at), ...poly.slice(0, at)]);
      continue;
    }
    const loop = dedupeLoop(poly);
    if (loop.length >= 3) { newFaces.push(out.f.length); out.f.push(loop); }
  }

  // 원래 면들: 모퉁이를 바꾸고, 깎이지 않은 모서리에 끼어든 점들을 순서대로 넣는다
  pm.f.forEach((face, fi) => {
    const n = face.length, loop = [];
    for (let k = 0; k < n; k++) {
      const u = face[k], w = face[(k + 1) % n], cu = cornerV[fi][k], cw = cornerV[fi][(k + 1) % n];
      if (cu !== DROP) loop.push(cu); else loop.push(...(absorb.get(`${fi}:${k}`) || []));
      const ek = edgeKey(u, w), pts = splits.get(ek);
      if (!pts || isBev(u, w)) continue;
      const e = list[E.index.get(ek)];
      const tOf = (orig, c) => (c === orig || c === DROP ? (orig === e.a ? 0 : 1) : (splitT.get(c) ?? (orig === e.a ? 0 : 1)));
      const tu = tOf(u, cu), tw = tOf(w, cw);
      const lo = Math.min(tu, tw), hi = Math.max(tu, tw);
      const inside = pts.filter(p => { const t = splitT.get(p); return t > lo + 1e-9 && t < hi - 1e-9; }).sort((p, q) => (splitT.get(p) - splitT.get(q)) * (tu < tw ? 1 : -1));
      loop.push(...inside);
    }
    out.f[fi] = dedupeLoop(loop);
  });

  // 아무도 안 쓰는 원래 정점 정리(면 번호는 그대로)
  const packed = compactPolyMesh(out);
  return { pm: packed, faces: newFaces };
}
// 연달아 같은 점, 갔다가 되돌아오는 가시(a,b,a) 를 없앤다
function dedupeLoop(loop) {
  let out = [];
  for (const vi of loop) if (out[out.length - 1] !== vi) out.push(vi);
  while (out.length > 1 && out[0] === out[out.length - 1]) out.pop();
  let changed = true;
  while (changed && out.length >= 3) {
    changed = false;
    for (let i = 0; i < out.length; i++) {
      const n = out.length;
      if (out[i] === out[(i + 2) % n]) { const drop = new Set([(i + 1) % n, (i + 2) % n]); out = out.filter((_, j) => !drop.has(j)); changed = true; break; }
    }
  }
  return out;
}

// ── 밀어내기: 고른 면들을 법선 방향으로 distance 만큼 밀고 옆면을 만든다. 영역 안쪽 정점은 그대로 옮기고 테두리 정점만 복제 ──
// 돌려주는 값: { pm, faces: 밀린(원래 번호 그대로) 면, verts: 새 정점, sides: 옆면 번호 }
export function extrudeFaces(pm, faceIds, distance) {
  const out = clonePolyMesh(pm);
  const sel = new Set((faceIds || []).filter(i => i >= 0 && i < pm.f.length));
  if (!sel.size) return { pm: out, faces: [], verts: [], sides: [] };
  const cnt = new Map();
  for (const fi of sel) { const face = pm.f[fi]; for (let k = 0; k < face.length; k++) { const key = edgeKey(face[k], face[(k + 1) % face.length]); cnt.set(key, (cnt.get(key) || 0) + 1); } }
  const boundary = [], bverts = new Set(), region = new Set();
  const nrm = new Map();
  for (const fi of sel) {
    const face = pm.f[fi], fn = pmFaceNormal(pm, fi, false);
    for (let k = 0; k < face.length; k++) {
      const u = face[k], w = face[(k + 1) % face.length];
      region.add(u);
      if (cnt.get(edgeKey(u, w)) === 1) { boundary.push([u, w]); bverts.add(u); bverts.add(w); }
      const acc = nrm.get(u) || [0, 0, 0]; nrm.set(u, add(acc, fn));
    }
  }
  const dup = new Map(), verts = [];
  for (const vi of region) {
    const p = add(pm.v[vi], scale(norm(nrm.get(vi)), distance));
    if (bverts.has(vi)) { dup.set(vi, out.v.length); verts.push(out.v.length); out.v.push(p); }
    else out.v[vi] = p;
  }
  for (const fi of sel) out.f[fi] = pm.f[fi].map(vi => dup.has(vi) ? dup.get(vi) : vi);
  const sides = [];
  for (const [u, w] of boundary) { sides.push(out.f.length); out.f.push([u, w, dup.get(w), dup.get(u)]); }
  return { pm: out, faces: [...sel], verts, sides };
}

// ── 면 지우기(안 쓰게 된 정점도 정리) ──
export function deleteFaces(pm, faceIds) {
  const del = new Set(faceIds || []);
  const kept = { v: pm.v.map(p => [p[0], p[1], p[2]]), f: pm.f.filter((_, i) => !del.has(i)).map(face => face.slice()) };
  return { pm: compactPolyMesh(kept) };
}

// ── 선택(점/선/면)을 베벨할 모서리 목록으로 ──
export function edgesOfSelection(pm, E, { mode = 'edge', verts = [], edges = [], faces = [] } = {}) {
  const list = E.list;
  if (mode === 'edge') return [...new Set(edges.filter(ei => list[ei]))];
  if (mode === 'face') {
    const s = new Set();
    for (const fi of faces) { const face = pm.f[fi]; if (!face) continue; for (let k = 0; k < face.length; k++) { const ei = E.index.get(edgeKey(face[k], face[(k + 1) % face.length])); if (ei !== undefined) s.add(ei); } }
    return [...s];
  }
  const vs = new Set(verts);
  let out = []; list.forEach((e, i) => { if (vs.has(e.a) && vs.has(e.b)) out.push(i); });
  if (!out.length) list.forEach((e, i) => { if (vs.has(e.a) || vs.has(e.b)) out.push(i); });
  return out;
}
