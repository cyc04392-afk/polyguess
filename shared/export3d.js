// 작품(scene JSON) → 다른 프로그램에서 여는 3D 파일. 엔진 독립(순수 JS): 브라우저·테스트에서 같이 쓴다.
//  - OBJ + MTL(색·재질)  → makeZip 으로 한 파일(.zip)에 담아 내려받는다
//  - FBX 바이너리 7.4      → 블렌더·마야·유니티가 바로 연다(블렌더는 ASCII FBX 를 못 읽으므로 바이너리)
// 물체의 위치·회전·크기는 정점에 미리 구워 넣고(월드 좌표, Y 위), 면은 다각형 그대로, 법선은 게임 화면과 같은 32° 크리스로 계산한다.
// 1 게임 단위 = 1 m (FBX UnitScaleFactor 100).
import { makePrimitive } from './primitives.js';
import { pmFromJSON, pmFaceNormal, pmVertexFaces } from './polymesh.js';
import { paintFromJSON, faceColor } from './paint.js';
import { PRIM_KINDS } from './scene.js';

export const CREASE_DEG = 32;
// 재질 느낌 → 파일의 재질 값 (spec: 반사 세기, shin: 광택, alpha: 불투명도, metal, rough, glow: 자체 발광 비율)
const FINISH_PROPS = {
  basic: { spec: 0.08, shin: 12, alpha: 1, metal: 0, rough: 0.7, glow: 0 },
  shiny: { spec: 0.5, shin: 120, alpha: 1, metal: 0, rough: 0.25, glow: 0 },
  metal: { spec: 0.85, shin: 200, alpha: 1, metal: 1, rough: 0.35, glow: 0 },
  glass: { spec: 0.6, shin: 250, alpha: 0.45, metal: 0, rough: 0.05, glow: 0 },
  glow: { spec: 0.05, shin: 10, alpha: 1, metal: 0, rough: 0.8, glow: 0.8 },
};
export const finishProps = f => FINISH_PROPS[f] || FINISH_PROPS.basic;
export const hexToRGB = hex => { const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '')); const n = m ? parseInt(m[1], 16) : 0xd9d9e3; return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
const safeName = s => String(s || 'polyguess').replace(/[^0-9A-Za-z_.-]+/g, '_').slice(0, 60) || 'polyguess';

function rotateQ([x, y, z], [qx, qy, qz, qw]) {
  // v' = v + 2·q×(q×v + w·v)
  const cx = qy * z - qz * y + qw * x, cy = qz * x - qx * z + qw * y, cz = qx * y - qy * x + qw * z;
  return [x + 2 * (qy * cz - qz * cy), y + 2 * (qz * cx - qx * cz), z + 2 * (qx * cy - qy * cx)];
}

// 면 모서리(코너)마다 법선: 그 면과 완만하게(크리스 각 미만) 만나는 이웃 면의 법선을 넓이 가중으로 더한다 — 화면 렌더와 같은 규칙
export function cornerNormals(pm, creaseDeg = CREASE_DEG) {
  const faceN = pm.f.map((_, fi) => pmFaceNormal(pm, fi, false));
  const unit = faceN.map(n => { const l = Math.hypot(n[0], n[1], n[2]) || 1; return [n[0] / l, n[1] / l, n[2] / l]; });
  const vfaces = pmVertexFaces(pm);
  const cosC = Math.cos((creaseDeg * Math.PI) / 180);
  const out = [];
  pm.f.forEach((face, fi) => {
    const u = unit[fi];
    for (const vi of face) {
      let sx = 0, sy = 0, sz = 0;
      for (const gi of vfaces[vi]) {
        const g = unit[gi], w = faceN[gi];
        if (gi === fi || g[0] * u[0] + g[1] * u[1] + g[2] * u[2] >= cosC) { sx += w[0]; sy += w[1]; sz += w[2]; }
      }
      const l = Math.hypot(sx, sy, sz);
      out.push(l > 1e-12 ? [sx / l, sy / l, sz / l] : u);
    }
  });
  return out;
}

// 장면 → 월드 좌표가 구워진 메시 목록과 재질 목록
//  meshes: [{ name, v:[[x,y,z]], f:[[i,…]], n:[[nx,ny,nz]] (면 코너 순서), mat:[재질 번호 per 면] }]
//  materials: [{ key, name, color:'#rrggbb', finish }]
export function sceneToMeshes(scene, { crease = CREASE_DEG } = {}) {
  const materials = [], matIndex = new Map();
  const matOf = (color, finish) => {
    const c = String(color || '#d9d9e3').toLowerCase(), f = FINISH_PROPS[finish] ? finish : 'basic', key = `${c}|${f}`;
    if (!matIndex.has(key)) { matIndex.set(key, materials.length); materials.push({ key, name: `m_${c.slice(1)}_${f}`, color: c, finish: f }); }
    return matIndex.get(key);
  };
  const meshes = [];
  let n = 0;
  for (const o of scene?.objects || []) {
    if (!o || o.kind === 'light') continue;
    let pm = null;
    try { pm = o.kind === 'mesh' ? pmFromJSON(o.mesh) : PRIM_KINDS.includes(o.kind) ? makePrimitive(o.kind, o.kind === 'clay') : null; } catch { pm = null; }
    if (!pm || !pm.f.length || !pm.v.length) continue;
    n++;
    const finish = o.mat?.f || 'basic';
    const paint = paintFromJSON(o.paint, pm.f.length);
    const base = matOf(o.mat?.c, finish);
    const mat = pm.f.map((_, fi) => { const c = faceColor(paint, fi); return c ? matOf(c, finish) : base; });
    const s = o.s || [1, 1, 1], q = o.q || [0, 0, 0, 1], p = o.p || [0, 0, 0];
    const v = pm.v.map(([x, y, z]) => { const r = rotateQ([x * s[0], y * s[1], z * s[2]], q); return [r[0] + p[0], r[1] + p[1], r[2] + p[2]]; });
    const f = pm.f.map(face => face.slice());
    meshes.push({ name: safeName(`${o.kind}_${o.id ?? n}`), v, f, n: cornerNormals({ v, f }, crease), mat });
  }
  return { meshes, materials };
}

// ───────── OBJ + MTL ─────────
const num = x => { const s = (Math.round(x * 1e5) / 1e5).toString(); return s === '-0' ? '0' : s; };
export function toOBJ(scene, name = 'polyguess') {
  name = safeName(name);
  const { meshes, materials } = sceneToMeshes(scene);
  const L = [`# PolyGuess — ${name}`, `# ${meshes.length} objects, 1 unit = 1 m, Y up`, `mtllib ${name}.mtl`];
  let vOff = 1, nOff = 1;
  for (const m of meshes) {
    L.push(`o ${m.name}`);
    for (const p of m.v) L.push(`v ${num(p[0])} ${num(p[1])} ${num(p[2])}`);
    const nIdx = new Map(), nList = [];
    const cn = m.n.map(nv => { const k = `${num(nv[0])} ${num(nv[1])} ${num(nv[2])}`; if (!nIdx.has(k)) { nIdx.set(k, nList.length); nList.push(k); } return nIdx.get(k); });
    for (const k of nList) L.push(`vn ${k}`);
    // 같은 재질의 면을 모아 usemtl 전환을 줄인다
    const byMat = new Map();
    m.f.forEach((face, fi) => { const k = m.mat[fi]; if (!byMat.has(k)) byMat.set(k, []); byMat.get(k).push(fi); });
    const cornerStart = []; let c = 0; for (const face of m.f) { cornerStart.push(c); c += face.length; }
    for (const [k, faces] of byMat) {
      L.push(`usemtl ${materials[k].name}`);
      for (const fi of faces) L.push('f ' + m.f[fi].map((vi, j) => `${vi + vOff}//${cn[cornerStart[fi] + j] + nOff}`).join(' '));
    }
    vOff += m.v.length; nOff += nList.length;
  }
  const M = [`# PolyGuess materials — ${name}`];
  for (const mt of materials) {
    const [r, g, b] = hexToRGB(mt.color), fp = finishProps(mt.finish);
    M.push(`newmtl ${mt.name}`, `Kd ${num(r)} ${num(g)} ${num(b)}`, `Ka ${num(r * 0.1)} ${num(g * 0.1)} ${num(b * 0.1)}`, `Ks ${num(fp.spec)} ${num(fp.spec)} ${num(fp.spec)}`, `Ns ${num(fp.shin)}`,
      `Ke ${num(r * fp.glow)} ${num(g * fp.glow)} ${num(b * fp.glow)}`, `d ${num(fp.alpha)}`, `Pr ${num(fp.rough)}`, `Pm ${num(fp.metal)}`, `illum ${fp.alpha < 1 ? 4 : 2}`, '');
  }
  return { obj: L.join('\n') + '\n', mtl: M.join('\n'), meshes: meshes.length, materials: materials.length };
}

// ───────── zip (압축 없이 담기만) ─────────
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[i] = c >>> 0; } return t; })();
export function crc32(u8) { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
const utf8 = s => new TextEncoder().encode(s);
export function makeZip(entries) {
  const parts = [], central = [];
  let offset = 0;
  const d = new Date(), dosTime = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff, dosDate = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;
  for (const e of entries) {
    const name = utf8(e.name), data = typeof e.data === 'string' ? utf8(e.data) : e.data, crc = crc32(data);
    const head = new DataView(new ArrayBuffer(30));
    head.setUint32(0, 0x04034b50, true); head.setUint16(4, 20, true); head.setUint16(6, 0x0800, true); head.setUint16(8, 0, true);
    head.setUint16(10, dosTime, true); head.setUint16(12, dosDate, true); head.setUint32(14, crc, true); head.setUint32(18, data.length, true); head.setUint32(22, data.length, true);
    head.setUint16(26, name.length, true); head.setUint16(28, 0, true);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x0800, true); cd.setUint16(10, 0, true);
    cd.setUint16(12, dosTime, true); cd.setUint16(14, dosDate, true); cd.setUint32(16, crc, true); cd.setUint32(20, data.length, true); cd.setUint32(24, data.length, true);
    cd.setUint16(28, name.length, true); cd.setUint16(30, 0, true); cd.setUint16(32, 0, true); cd.setUint16(34, 0, true); cd.setUint16(36, 0, true); cd.setUint32(38, 0, true); cd.setUint32(42, offset, true);
    parts.push(new Uint8Array(head.buffer), name, data); central.push(new Uint8Array(cd.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((a, b) => a + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(4, 0, true); end.setUint16(6, 0, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true); end.setUint16(20, 0, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0));
  let o = 0; for (const p of all) { out.set(p, o); o += p.length; }
  return out;
}

// ───────── FBX 바이너리 7.4 ─────────
// 노드 = { name, props: [[type, value], …], kids: [노드] }. 타입: C(불) I(int32) L(int64) D(double) S(문자열) R(바이트) d(double[]) i(int32[])
class ByteWriter {
  constructor() { this.buf = new Uint8Array(1 << 16); this.len = 0; }
  need(n) { if (this.len + n > this.buf.length) { let c = this.buf.length * 2; while (c < this.len + n) c *= 2; const b = new Uint8Array(c); b.set(this.buf.subarray(0, this.len)); this.buf = b; } }
  bytes(u8) { this.need(u8.length); this.buf.set(u8, this.len); this.len += u8.length; }
  u8(v) { this.need(1); this.buf[this.len++] = v & 255; }
  u32(v) { this.need(4); new DataView(this.buf.buffer).setUint32(this.len, v >>> 0, true); this.len += 4; }
  i32(v) { this.need(4); new DataView(this.buf.buffer).setInt32(this.len, v | 0, true); this.len += 4; }
  i64(v) { this.need(8); new DataView(this.buf.buffer).setBigInt64(this.len, BigInt(v), true); this.len += 8; }
  f64(v) { this.need(8); new DataView(this.buf.buffer).setFloat64(this.len, v, true); this.len += 8; }
  patchU32(at, v) { new DataView(this.buf.buffer).setUint32(at, v >>> 0, true); }
  out() { return this.buf.slice(0, this.len); }
}
const N = (name, props = [], kids = []) => ({ name, props, kids });
const S = v => ['S', String(v)], I = v => ['I', v], L = v => ['L', v], D = v => ['D', v], C = v => ['C', v ? 1 : 0], R = v => ['R', v], DA = v => ['d', v], IA = v => ['i', v];
const P = (name, type, label, flags, ...vals) => N('P', [S(name), S(type), S(label), S(flags), ...vals]);
function writeProp(w, [t, v]) {
  w.u8(t.charCodeAt(0));
  switch (t) {
    case 'C': w.u8(v); break;
    case 'I': w.i32(v); break;
    case 'L': w.i64(v); break;
    case 'D': w.f64(v); break;
    case 'S': { const b = utf8(v); w.u32(b.length); w.bytes(b); break; }
    case 'R': w.u32(v.length); w.bytes(v); break;
    case 'd': { w.u32(v.length); w.u32(0); w.u32(v.length * 8); const b = new Uint8Array(v.length * 8), dv = new DataView(b.buffer); for (let i = 0; i < v.length; i++) dv.setFloat64(i * 8, v[i], true); w.bytes(b); break; }
    case 'i': { w.u32(v.length); w.u32(0); w.u32(v.length * 4); const b = new Uint8Array(v.length * 4), dv = new DataView(b.buffer); for (let i = 0; i < v.length; i++) dv.setInt32(i * 4, v[i], true); w.bytes(b); break; }
    default: throw new Error('bad prop type ' + t);
  }
}
const SENTINEL = new Uint8Array(13);
function writeNode(w, node) {
  const start = w.len;
  w.u32(0); w.u32(node.props.length); w.u32(0);
  const nameB = utf8(node.name); w.u8(nameB.length); w.bytes(nameB);
  const p0 = w.len;
  for (const p of node.props) writeProp(w, p);
  w.patchU32(start + 8, w.len - p0);
  if (node.kids.length || node.props.length === 0) { for (const k of node.kids) writeNode(w, k); w.bytes(SENTINEL); }
  w.patchU32(start, w.len);
}
const FILE_ID = Uint8Array.from([0x28, 0xb3, 0x2a, 0xeb, 0xb6, 0x24, 0xcc, 0xc2, 0xbf, 0xc8, 0xb0, 0x2a, 0xa9, 0x2b, 0xfc, 0xf1]);
const FOOT_ID = Uint8Array.from([0xfa, 0xbc, 0xab, 0x09, 0xd0, 0xc8, 0xd4, 0x66, 0xb1, 0x76, 0xfb, 0x83, 0x1c, 0xf7, 0x26, 0x7e]);
export const FBX_FOOT_MAGIC = Uint8Array.from([0xf8, 0x5a, 0x8c, 0x6a, 0xde, 0xf5, 0xd9, 0x7e, 0xec, 0xe9, 0x0c, 0xe3, 0x75, 0x8f, 0x29, 0x0b]);
export const FBX_VERSION = 7400;

export function toFBX(scene, name = 'polyguess') {
  name = safeName(name);
  const { meshes, materials } = sceneToMeshes(scene);
  let nextId = 1000000;
  const id = () => ++nextId;
  const now = new Date();
  const header = N('FBXHeaderExtension', [], [
    N('FBXHeaderVersion', [I(1003)]), N('FBXVersion', [I(FBX_VERSION)]), N('EncryptionType', [I(0)]),
    N('CreationTimeStamp', [], [N('Version', [I(1000)]), N('Year', [I(now.getFullYear())]), N('Month', [I(now.getMonth() + 1)]), N('Day', [I(now.getDate())]), N('Hour', [I(now.getHours())]), N('Minute', [I(now.getMinutes())]), N('Second', [I(now.getSeconds())]), N('Millisecond', [I(0)])]),
    N('Creator', [S('PolyGuess')]),
    N('SceneInfo', [S('GlobalInfo\x00\x01SceneInfo'), S('UserData')], [
      N('Type', [S('UserData')]), N('Version', [I(100)]),
      N('MetaData', [], [N('Version', [I(100)]), N('Title', [S(name)]), N('Subject', [S('')]), N('Author', [S('')]), N('Keywords', [S('')]), N('Revision', [S('')]), N('Comment', [S('')])]),
      N('Properties70', [], [
        P('DocumentUrl', 'KString', 'Url', '', S(`${name}.fbx`)), P('SrcDocumentUrl', 'KString', 'Url', '', S(`${name}.fbx`)),
        P('Original', 'Compound', '', ''), P('Original|ApplicationVendor', 'KString', '', '', S('PolyGuess')), P('Original|ApplicationName', 'KString', '', '', S('PolyGuess')), P('Original|ApplicationVersion', 'KString', '', '', S('1.0')),
        P('Original|FileName', 'KString', '', '', S(`${name}.fbx`)),
        P('LastSaved', 'Compound', '', ''), P('LastSaved|ApplicationVendor', 'KString', '', '', S('PolyGuess')), P('LastSaved|ApplicationName', 'KString', '', '', S('PolyGuess')), P('LastSaved|ApplicationVersion', 'KString', '', '', S('1.0')),
      ]),
    ]),
  ]);
  const globalSettings = N('GlobalSettings', [], [N('Version', [I(1000)]), N('Properties70', [], [
    P('UpAxis', 'int', 'Integer', '', I(1)), P('UpAxisSign', 'int', 'Integer', '', I(1)), P('FrontAxis', 'int', 'Integer', '', I(2)), P('FrontAxisSign', 'int', 'Integer', '', I(1)),
    P('CoordAxis', 'int', 'Integer', '', I(0)), P('CoordAxisSign', 'int', 'Integer', '', I(1)), P('OriginalUpAxis', 'int', 'Integer', '', I(1)), P('OriginalUpAxisSign', 'int', 'Integer', '', I(1)),
    P('UnitScaleFactor', 'double', 'Number', '', D(100)), P('OriginalUnitScaleFactor', 'double', 'Number', '', D(100)),
    P('AmbientColor', 'ColorRGB', 'Color', '', D(0), D(0), D(0)), P('DefaultCamera', 'KString', '', '', S('Producer Perspective')),
    P('TimeMode', 'enum', '', '', I(11)), P('TimeSpanStart', 'KTime', 'Time', '', L(0)), P('TimeSpanStop', 'KTime', 'Time', '', L(46186158000)), P('CustomFrameRate', 'double', 'Number', '', D(24)),
  ])]);
  const docId = id();
  const documents = N('Documents', [], [N('Count', [I(1)]), N('Document', [L(docId), S('Scene'), S('Scene')], [
    N('Properties70', [], [P('SourceObject', 'object', '', ''), P('ActiveAnimStackName', 'KString', '', '', S(''))]), N('RootNode', [L(0)])])]);
  const references = N('References');
  const objects = [], connections = [];
  const matIds = materials.map(() => id());
  materials.forEach((mt, k) => {
    const [r, g, b] = hexToRGB(mt.color), fp = finishProps(mt.finish);
    objects.push(N('Material', [L(matIds[k]), S(`${mt.name}\x00\x01Material`), S('')], [
      N('Version', [I(102)]), N('ShadingModel', [S('Phong')]), N('MultiLayer', [I(0)]),
      N('Properties70', [], [
        P('ShadingModel', 'KString', '', '', S('Phong')),
        P('EmissiveColor', 'Color', '', 'A', D(r), D(g), D(b)), P('EmissiveFactor', 'Number', '', 'A', D(fp.glow)),
        P('AmbientColor', 'Color', '', 'A', D(0), D(0), D(0)), P('AmbientFactor', 'Number', '', 'A', D(0)),
        P('DiffuseColor', 'Color', '', 'A', D(r), D(g), D(b)), P('DiffuseFactor', 'Number', '', 'A', D(1)),
        P('TransparentColor', 'Color', '', 'A', D(1), D(1), D(1)), P('TransparencyFactor', 'Number', '', 'A', D(1 - fp.alpha)), P('Opacity', 'Number', '', 'A', D(fp.alpha)),
        P('SpecularColor', 'Color', '', 'A', D(fp.spec), D(fp.spec), D(fp.spec)), P('SpecularFactor', 'Number', '', 'A', D(1)),
        P('Shininess', 'Number', '', 'A', D(fp.shin)), P('ShininessExponent', 'Number', '', 'A', D(fp.shin)),
        P('ReflectionColor', 'Color', '', 'A', D(1), D(1), D(1)), P('ReflectionFactor', 'Number', '', 'A', D(fp.metal ? 0.8 : fp.spec * 0.3)),
      ]),
    ]));
  });
  for (const m of meshes) {
    const geomId = id(), modelId = id();
    const verts = new Array(m.v.length * 3); m.v.forEach((p, i) => { verts[i * 3] = p[0]; verts[i * 3 + 1] = p[1]; verts[i * 3 + 2] = p[2]; });
    const pvi = []; for (const face of m.f) face.forEach((vi, k) => pvi.push(k === face.length - 1 ? -vi - 1 : vi));
    const normals = new Array(m.n.length * 3); m.n.forEach((nv, i) => { normals[i * 3] = nv[0]; normals[i * 3 + 1] = nv[1]; normals[i * 3 + 2] = nv[2]; });
    // 이 물체가 쓰는 재질만 모델에 연결하고, 면의 재질 번호는 그 순서(0부터)로
    const local = [...new Set(m.mat)], localIdx = new Map(local.map((k, i) => [k, i]));
    const faceMat = m.mat.map(k => localIdx.get(k));
    const allSame = local.length === 1;
    objects.push(N('Geometry', [L(geomId), S(`${m.name}\x00\x01Geometry`), S('Mesh')], [
      N('GeometryVersion', [I(124)]), N('Vertices', [DA(verts)]), N('PolygonVertexIndex', [IA(pvi)]),
      N('LayerElementNormal', [I(0)], [N('Version', [I(101)]), N('Name', [S('')]), N('MappingInformationType', [S('ByPolygonVertex')]), N('ReferenceInformationType', [S('Direct')]), N('Normals', [DA(normals)])]),
      N('LayerElementMaterial', [I(0)], [N('Version', [I(101)]), N('Name', [S('')]), N('MappingInformationType', [S(allSame ? 'AllSame' : 'ByPolygon')]), N('ReferenceInformationType', [S('IndexToDirect')]), N('Materials', [IA(allSame ? [0] : faceMat)])]),
      N('Layer', [I(0)], [N('Version', [I(100)]), N('LayerElement', [], [N('Type', [S('LayerElementNormal')]), N('TypedIndex', [I(0)])]), N('LayerElement', [], [N('Type', [S('LayerElementMaterial')]), N('TypedIndex', [I(0)])])]),
    ]));
    objects.push(N('Model', [L(modelId), S(`${m.name}\x00\x01Model`), S('Mesh')], [
      N('Version', [I(232)]),
      N('Properties70', [], [
        P('Lcl Translation', 'Lcl Translation', '', 'A', D(0), D(0), D(0)), P('Lcl Rotation', 'Lcl Rotation', '', 'A', D(0), D(0), D(0)), P('Lcl Scaling', 'Lcl Scaling', '', 'A', D(1), D(1), D(1)),
        P('DefaultAttributeIndex', 'int', 'Integer', '', I(0)), P('InheritType', 'enum', '', '', I(1)),
      ]),
      N('Shading', [C(1)]), N('Culling', [S('CullingOff')]),
    ]));
    connections.push(N('C', [S('OO'), L(modelId), L(0)]), N('C', [S('OO'), L(geomId), L(modelId)]));
    for (const k of local) connections.push(N('C', [S('OO'), L(matIds[k]), L(modelId)]));
  }
  const definitions = N('Definitions', [], [
    N('Version', [I(100)]), N('Count', [I(1 + meshes.length * 2 + materials.length)]),
    N('ObjectType', [S('GlobalSettings')], [N('Count', [I(1)])]),
    N('ObjectType', [S('Model')], [N('Count', [I(meshes.length)]), N('PropertyTemplate', [S('FbxNode')], [N('Properties70', [], [
      P('Lcl Translation', 'Lcl Translation', '', 'A', D(0), D(0), D(0)), P('Lcl Rotation', 'Lcl Rotation', '', 'A', D(0), D(0), D(0)), P('Lcl Scaling', 'Lcl Scaling', '', 'A', D(1), D(1), D(1)),
      P('Visibility', 'Visibility', '', 'A', D(1)), P('DefaultAttributeIndex', 'int', 'Integer', '', I(-1)), P('InheritType', 'enum', '', '', I(0)),
    ])])]),
    N('ObjectType', [S('Geometry')], [N('Count', [I(meshes.length)]), N('PropertyTemplate', [S('FbxMesh')], [N('Properties70', [], [
      P('Color', 'ColorRGB', 'Color', '', D(0.8), D(0.8), D(0.8)), P('Primary Visibility', 'bool', '', '', I(1)), P('Casts Shadows', 'bool', '', '', I(1)), P('Receive Shadows', 'bool', '', '', I(1)),
    ])])]),
    N('ObjectType', [S('Material')], [N('Count', [I(materials.length)]), N('PropertyTemplate', [S('FbxSurfacePhong')], [N('Properties70', [], [
      P('ShadingModel', 'KString', '', '', S('Phong')), P('MultiLayer', 'bool', '', '', I(0)),
      P('EmissiveColor', 'Color', '', 'A', D(0), D(0), D(0)), P('EmissiveFactor', 'Number', '', 'A', D(1)),
      P('AmbientColor', 'Color', '', 'A', D(0.2), D(0.2), D(0.2)), P('AmbientFactor', 'Number', '', 'A', D(1)),
      P('DiffuseColor', 'Color', '', 'A', D(0.8), D(0.8), D(0.8)), P('DiffuseFactor', 'Number', '', 'A', D(1)),
      P('TransparentColor', 'Color', '', 'A', D(0), D(0), D(0)), P('TransparencyFactor', 'Number', '', 'A', D(0)), P('Opacity', 'Number', '', 'A', D(1)),
      P('SpecularColor', 'Color', '', 'A', D(0.2), D(0.2), D(0.2)), P('SpecularFactor', 'Number', '', 'A', D(1)),
      P('Shininess', 'Number', '', 'A', D(20)), P('ShininessExponent', 'Number', '', 'A', D(20)),
      P('ReflectionColor', 'Color', '', 'A', D(0), D(0), D(0)), P('ReflectionFactor', 'Number', '', 'A', D(1)),
    ])])]),
  ]);
  const top = [
    header, N('FileId', [R(FILE_ID)]), N('CreationTime', [S('1970-01-01 10:00:00:000')]), N('Creator', [S('PolyGuess')]),
    globalSettings, documents, references, definitions, N('Objects', [], objects), N('Connections', [], connections), N('Takes', [], [N('Current', [S('')])]),
  ];
  const w = new ByteWriter();
  w.bytes(utf8('Kaydara FBX Binary  ')); w.u8(0); w.u8(0x1a); w.u8(0); w.u32(FBX_VERSION);
  for (const n of top) writeNode(w, n);
  w.bytes(SENTINEL);
  // 꼬리: 알려진 footer id + 0 ×4 + 16바이트 정렬 채우기 + 버전 + 0 ×120 + 끝 표식
  w.bytes(FOOT_ID); w.bytes(new Uint8Array(4));
  const pad = (16 - (w.len % 16)) % 16; w.bytes(new Uint8Array(pad));
  w.u32(FBX_VERSION); w.bytes(new Uint8Array(120)); w.bytes(FBX_FOOT_MAGIC);
  return w.out();
}

// 테스트·검증용: 바이너리 FBX 를 노드 트리로 되읽기 { name, props:[[type,value]], kids }
export function parseFBX(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), dec = new TextDecoder();
  if (dec.decode(u8.subarray(0, 20)) !== 'Kaydara FBX Binary  ') throw new Error('not a binary FBX');
  const version = dv.getUint32(23, true);
  let pos = 27;
  const readProp = () => {
    const t = String.fromCharCode(u8[pos++]);
    let v;
    switch (t) {
      case 'C': v = u8[pos++]; break;
      case 'Y': v = dv.getInt16(pos, true); pos += 2; break;
      case 'I': v = dv.getInt32(pos, true); pos += 4; break;
      case 'L': v = Number(dv.getBigInt64(pos, true)); pos += 8; break;
      case 'F': v = dv.getFloat32(pos, true); pos += 4; break;
      case 'D': v = dv.getFloat64(pos, true); pos += 8; break;
      case 'S': case 'R': { const n = dv.getUint32(pos, true); pos += 4; v = t === 'S' ? dec.decode(u8.subarray(pos, pos + n)) : u8.slice(pos, pos + n); pos += n; break; }
      case 'd': case 'i': case 'f': case 'l': case 'b': {
        const n = dv.getUint32(pos, true), enc = dv.getUint32(pos + 4, true), len = dv.getUint32(pos + 8, true); pos += 12;
        if (enc !== 0) throw new Error('compressed arrays not supported');
        const size = { d: 8, i: 4, f: 4, l: 8, b: 1 }[t];
        if (len !== n * size) throw new Error('array length mismatch');
        v = []; for (let k = 0; k < n; k++) v.push(t === 'd' ? dv.getFloat64(pos + k * 8, true) : t === 'i' ? dv.getInt32(pos + k * 4, true) : t === 'f' ? dv.getFloat32(pos + k * 4, true) : t === 'l' ? Number(dv.getBigInt64(pos + k * 8, true)) : u8[pos + k]);
        pos += len; break;
      }
      default: throw new Error('bad prop type ' + t + ' at ' + (pos - 1));
    }
    return [t, v];
  };
  const readNode = () => {
    const end = dv.getUint32(pos, true); if (end === 0) { pos += 13; return null; }
    const nProps = dv.getUint32(pos + 4, true), propLen = dv.getUint32(pos + 8, true), nameLen = u8[pos + 12];
    const name = dec.decode(u8.subarray(pos + 13, pos + 13 + nameLen)); pos += 13 + nameLen;
    const p0 = pos, props = []; for (let k = 0; k < nProps; k++) props.push(readProp());
    if (pos - p0 !== propLen) throw new Error('property length mismatch in ' + name);
    const kids = [];
    if (pos < end) {
      while (pos < end - 13) { const k = readNode(); if (!k) throw new Error('unexpected null record in ' + name); kids.push(k); }
      for (let k = 0; k < 13; k++) if (u8[pos + k] !== 0) throw new Error('bad sentinel in ' + name);
      pos += 13;
    }
    if (pos !== end) throw new Error('scope length mismatch in ' + name);
    return { name, props, kids };
  };
  const top = [];
  for (;;) { const n = readNode(); if (!n) break; top.push(n); }
  return { version, top, footerAt: pos };
}
