// 다각형 메시(폴리메시) 공통 모듈 — 렌더러·엔진 무관(순수 JS). 브라우저와 Node 양쪽에서 쓴다.
//
// pm = { v: [[x,y,z], ...], f: [[i0,i1,i2,...], ...] }
//   - 면은 바깥에서 봤을 때 반시계(CCW). 삼각형·사각형·n각형 모두 허용. Y축이 위.
//   - 모서리 번호는 pmEdges() 가 만든 목록 기준(정점 쌍 → edgeKey).
import { b64 } from './scene.js';

export const edgeKey = (a, b) => (a < b ? a * 1048576 + b : b * 1048576 + a);
export const edgeKeyPair = key => [Math.floor(key / 1048576), key % 1048576];

export function makePolyMesh(v = [], f = []) { return { v, f }; }
export function clonePolyMesh(pm) { return { v: pm.v.map(p => [p[0], p[1], p[2]]), f: pm.f.map(face => face.slice()) }; }

// 모서리 목록. list[i] = { a, b, faces:[면 번호…] } (a < b), index: edgeKey → i
export function pmEdges(pm) {
  const list = [], index = new Map();
  pm.f.forEach((face, fi) => {
    for (let k = 0; k < face.length; k++) {
      const a = face[k], b = face[(k + 1) % face.length];
      const key = edgeKey(a, b);
      let ei = index.get(key);
      if (ei === undefined) { ei = list.length; index.set(key, ei); list.push({ a: Math.min(a, b), b: Math.max(a, b), faces: [] }); }
      list[ei].faces.push(fi);
    }
  });
  return { list, index };
}

// 정점마다 붙어 있는 면 번호들
export function pmVertexFaces(pm) {
  const out = pm.v.map(() => []);
  pm.f.forEach((face, fi) => { for (const vi of face) out[vi].push(fi); });
  return out;
}
// 정점마다 모서리로 이어진 이웃 정점들
export function pmNeighbors(pm) {
  const sets = pm.v.map(() => new Set());
  for (const face of pm.f) for (let k = 0; k < face.length; k++) { const a = face[k], b = face[(k + 1) % face.length]; if (a !== b) { sets[a].add(b); sets[b].add(a); } }
  return sets.map(s => [...s]);
}

// 면의 법선(뉴웰 방법, 길이 1). 넓이 가중치가 필요하면 normalize=false.
export function pmFaceNormal(pm, fi, normalize = true) {
  const face = pm.f[fi], v = pm.v;
  let nx = 0, ny = 0, nz = 0;
  for (let k = 0; k < face.length; k++) {
    const p = v[face[k]], q = v[face[(k + 1) % face.length]];
    nx += (p[1] - q[1]) * (p[2] + q[2]);
    ny += (p[2] - q[2]) * (p[0] + q[0]);
    nz += (p[0] - q[0]) * (p[1] + q[1]);
  }
  if (!normalize) return [nx / 2, ny / 2, nz / 2];
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}
export function pmFaceCenter(pm, fi) {
  const face = pm.f[fi], c = [0, 0, 0];
  for (const vi of face) { const p = pm.v[vi]; c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; }
  return [c[0] / face.length, c[1] / face.length, c[2] / face.length];
}
// 정점 법선(붙은 면들의 넓이 가중 평균) → Float32Array(3n)
export function pmVertexNormals(pm) {
  const n = pm.v.length, out = new Float32Array(n * 3);
  for (let fi = 0; fi < pm.f.length; fi++) {
    const fn = pmFaceNormal(pm, fi, false);
    for (const vi of pm.f[fi]) { out[vi * 3] += fn[0]; out[vi * 3 + 1] += fn[1]; out[vi * 3 + 2] += fn[2]; }
  }
  for (let i = 0; i < n; i++) {
    const l = Math.hypot(out[i * 3], out[i * 3 + 1], out[i * 3 + 2]);
    if (l > 1e-12) { out[i * 3] /= l; out[i * 3 + 1] /= l; out[i * 3 + 2] /= l; } else out[i * 3 + 1] = 1;
  }
  return out;
}
export function pmBounds(pm) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const p of pm.v) for (let k = 0; k < 3; k++) { if (p[k] < min[k]) min[k] = p[k]; if (p[k] > max[k]) max[k] = p[k]; }
  if (!pm.v.length) return { min: [0, 0, 0], max: [0, 0, 0] };
  return { min, max };
}
export function pmStats(pm) {
  let tris = 0;
  for (const face of pm.f) tris += face.length === 3 ? 1 : face.length === 4 ? 2 : face.length;
  return { verts: pm.v.length, faces: pm.f.length, edges: pmEdges(pm).list.length, tris };
}
export function pmValidate(pm) {
  const errors = [];
  if (!pm || !Array.isArray(pm.v) || !Array.isArray(pm.f)) return { ok: false, errors: ['not a polymesh'] };
  const n = pm.v.length;
  pm.v.forEach((p, i) => { if (!Array.isArray(p) || p.length !== 3 || p.some(x => !Number.isFinite(x))) errors.push(`vertex ${i} invalid`); });
  pm.f.forEach((face, fi) => {
    if (!Array.isArray(face) || face.length < 3) { errors.push(`face ${fi} has < 3 vertices`); return; }
    const seen = new Set();
    for (const vi of face) {
      if (!Number.isInteger(vi) || vi < 0 || vi >= n) { errors.push(`face ${fi} index ${vi} out of range`); break; }
      if (seen.has(vi)) { errors.push(`face ${fi} repeats vertex ${vi}`); break; }
      seen.add(vi);
    }
  });
  return { ok: errors.length === 0, errors };
}
// 정점 위치 바꾸기(제자리). indices 가 null 이면 전부. fn([x,y,z], i) → [x,y,z]
export function pmTransform(pm, indices, fn) {
  const idx = indices || pm.v.map((_, i) => i);
  for (const i of idx) { const r = fn(pm.v[i], i); pm.v[i] = [r[0], r[1], r[2]]; }
  return pm;
}
// x축 대칭 복사(정점 x 반전 + 면 방향 뒤집기) → 새 메시
export function pmFlipX(pm) {
  return { v: pm.v.map(p => [-p[0], p[1], p[2]]), f: pm.f.map(face => face.slice().reverse()) };
}

// 삼각형 묶음(위치 배열 + 인덱스 또는 null) → 폴리메시. 같은 자리 정점은 하나로 합친다.
export function pmFromTriangles(positions, indices = null, eps = 1e-6) {
  const map = new Map(), v = [], remap = [];
  const q = 1 / eps;
  const nv = positions.length / 3;
  for (let i = 0; i < nv; i++) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    const key = `${Math.round(x * q)},${Math.round(y * q)},${Math.round(z * q)}`;
    let id = map.get(key);
    if (id === undefined) { id = v.length; map.set(key, id); v.push([x, y, z]); }
    remap.push(id);
  }
  const f = [];
  const nt = indices ? indices.length / 3 : nv / 3;
  for (let t = 0; t < nt; t++) {
    const a = remap[indices ? indices[t * 3] : t * 3], b = remap[indices ? indices[t * 3 + 1] : t * 3 + 1], c = remap[indices ? indices[t * 3 + 2] : t * 3 + 2];
    if (a === b || b === c || a === c) continue;
    f.push([a, b, c]);
  }
  return { v, f };
}

// 저장 포맷 { pos, fv, fn } (base64) ↔ 폴리메시
export function pmToJSON(pm) {
  const pos = new Float32Array(pm.v.length * 3);
  pm.v.forEach((p, i) => { pos[i * 3] = p[0]; pos[i * 3 + 1] = p[1]; pos[i * 3 + 2] = p[2]; });
  let total = 0; for (const face of pm.f) total += face.length;
  const fv = new Uint32Array(total), fn = new Uint8Array(pm.f.length);
  let o = 0;
  pm.f.forEach((face, i) => { fn[i] = face.length; for (const vi of face) fv[o++] = vi; });
  return { pos: b64.fromF32(pos), fv: b64.fromU32(fv), fn: b64.fromU8(fn) };
}
export function pmFromJSON(j) {
  if (!j || typeof j.pos !== 'string') return null;
  const pos = b64.toF32(j.pos);
  if (typeof j.fv === 'string' && typeof j.fn === 'string') {
    const fv = b64.toU32(j.fv), fn = b64.toU8(j.fn);
    const v = []; for (let i = 0; i < pos.length; i += 3) v.push([pos[i], pos[i + 1], pos[i + 2]]);
    const f = []; let o = 0;
    for (let i = 0; i < fn.length; i++) { const face = []; for (let k = 0; k < fn[i]; k++) face.push(fv[o++]); f.push(face); }
    return { v, f };
  }
  // 옛 포맷: 삼각형 인덱스(또는 인덱스 없는 삼각형 묶음)
  const idx = j.idx ? b64.toU32(j.idx) : null;
  return pmFromTriangles(pos, idx, 1e-5);
}

// 렌더링용 버퍼(인덱스 없는 삼각형 묶음). 사각형은 대각선으로, 5각 이상은 중심점을 더해 부채꼴로 쪼갠다.
// creaseDeg 보다 완만하게 만나는 면끼리는 법선을 섞어 매끈하게, 더 꺾이면 또렷하게.
// 돌려주는 값: { position, normal, triFace(삼각형 → 면 번호), cornerVertex(삼각형 꼭짓점 → 정점 번호, 중심점은 -1), update(pm) }
export function pmRenderBuffers(pm, { creaseDeg = 32 } = {}) {
  const corners = [];   // [vertexIndex | -1(중심), faceIndex] 삼각형 꼭짓점 순서대로
  const triFace = [];
  pm.f.forEach((face, fi) => {
    const n = face.length;
    if (n === 3) { corners.push(face[0], fi, face[1], fi, face[2], fi); triFace.push(fi); }
    else if (n === 4) { corners.push(face[0], fi, face[1], fi, face[2], fi, face[0], fi, face[2], fi, face[3], fi); triFace.push(fi, fi); }
    else for (let k = 0; k < n; k++) { corners.push(-1, fi, face[k], fi, face[(k + 1) % n], fi); triFace.push(fi); }
  });
  const nc = corners.length / 2;
  const position = new Float32Array(nc * 3), normal = new Float32Array(nc * 3);
  const triFaceArr = Uint32Array.from(triFace);
  const cornerVertex = new Int32Array(nc);
  for (let i = 0; i < nc; i++) cornerVertex[i] = corners[i * 2];
  const vfaces = pmVertexFaces(pm);
  const cosCrease = Math.cos((creaseDeg * Math.PI) / 180);
  const faceN = new Float32Array(pm.f.length * 3), faceC = new Float32Array(pm.f.length * 3);

  function update(cur) {
    const v = cur.v;
    for (let fi = 0; fi < cur.f.length; fi++) {
      const fn = pmFaceNormal(cur, fi, false);              // 넓이 가중
      faceN[fi * 3] = fn[0]; faceN[fi * 3 + 1] = fn[1]; faceN[fi * 3 + 2] = fn[2];
      if (cur.f[fi].length > 4) { const c = pmFaceCenter(cur, fi); faceC[fi * 3] = c[0]; faceC[fi * 3 + 1] = c[1]; faceC[fi * 3 + 2] = c[2]; }
    }
    for (let i = 0; i < nc; i++) {
      const vi = corners[i * 2], fi = corners[i * 2 + 1];
      let nx = faceN[fi * 3], ny = faceN[fi * 3 + 1], nz = faceN[fi * 3 + 2];
      const fl = Math.hypot(nx, ny, nz) || 1;
      const ux = nx / fl, uy = ny / fl, uz = nz / fl;
      if (vi < 0) {
        position[i * 3] = faceC[fi * 3]; position[i * 3 + 1] = faceC[fi * 3 + 1]; position[i * 3 + 2] = faceC[fi * 3 + 2];
        normal[i * 3] = ux; normal[i * 3 + 1] = uy; normal[i * 3 + 2] = uz;
        continue;
      }
      const p = v[vi];
      position[i * 3] = p[0]; position[i * 3 + 1] = p[1]; position[i * 3 + 2] = p[2];
      // 이 면과 완만하게 만나는 이웃 면들의 법선을 더한다
      let sx = 0, sy = 0, sz = 0;
      for (const gi of vfaces[vi]) {
        const gx = faceN[gi * 3], gy = faceN[gi * 3 + 1], gz = faceN[gi * 3 + 2];
        const gl = Math.hypot(gx, gy, gz);
        if (gl < 1e-12) continue;
        if (gi === fi || (gx * ux + gy * uy + gz * uz) / gl >= cosCrease) { sx += gx; sy += gy; sz += gz; }
      }
      const sl = Math.hypot(sx, sy, sz);
      if (sl > 1e-12) { normal[i * 3] = sx / sl; normal[i * 3 + 1] = sy / sl; normal[i * 3 + 2] = sz / sl; }
      else { normal[i * 3] = ux; normal[i * 3 + 1] = uy; normal[i * 3 + 2] = uz; }
    }
  }
  update(pm);
  return { position, normal, triFace: triFaceArr, cornerVertex, update };
}

// 부호 있는 부피(닫힌 메시가 바깥을 향해 CCW 면 이면 양수)
export function pmSignedVolume(pm) {
  let vol = 0;
  const v = pm.v;
  for (const face of pm.f) {
    const n = face.length;
    if (n === 3) vol += tet(v[face[0]], v[face[1]], v[face[2]]);
    else if (n === 4) vol += tet(v[face[0]], v[face[1]], v[face[2]]) + tet(v[face[0]], v[face[2]], v[face[3]]);
    else { const c = [0, 0, 0]; for (const vi of face) { c[0] += v[vi][0] / n; c[1] += v[vi][1] / n; c[2] += v[vi][2] / n; } for (let k = 0; k < n; k++) vol += tet(c, v[face[k]], v[face[(k + 1) % n]]); }
  }
  return vol;
}
const tet = (a, b, c) => (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
