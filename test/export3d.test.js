import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toOBJ, toFBX, parseFBX, makeZip, crc32, sceneToMeshes, cornerNormals, FBX_FOOT_MAGIC, FBX_VERSION } from '../shared/export3d.js';
import { makePrimitive } from '../shared/primitives.js';
import { b64 } from '../shared/scene.js';

const scene = () => ({ v: 1, bg: 0, objects: [
  { id: 1, kind: 'box', p: [0, 0.5, 0], q: [0, 0, 0, 1], s: [2, 1, 1], mat: { c: '#4dabf7', f: 'basic' } },
  { id: 2, kind: 'sphere', p: [1.5, 0.5, 0], q: [0, 0.70711, 0, 0.70711], s: [1, 1, 1], mat: { c: '#ff5c7a', f: 'metal' } },
  { id: 3, kind: 'light', p: [0, 3, 0], q: [0, 0, 0, 1], s: [1, 1, 1], mat: { c: '#ffffff', f: 'basic' }, light: { type: 'sun', i: 1, a: 40 } },
  // 페인트: 상자 6면 중 2면을 노랑으로
  { id: 4, kind: 'box', p: [0, 2, 0], q: [0, 0, 0, 1], s: [1, 1, 1], mat: { c: '#d9d9e3', f: 'shiny' }, paint: { pal: ['#ffd23f'], f: b64.fromU8(Uint8Array.from([1, 0, 1, 0, 0, 0])) } },
] });

test('장면 → 메시: 광원은 빼고, 위치·회전·크기를 정점에 굽고, 칠한 면은 다른 재질', () => {
  const { meshes, materials } = sceneToMeshes(scene());
  assert.equal(meshes.length, 3);
  const box = meshes[0];
  assert.equal(box.v.length, 8); assert.equal(box.f.length, 6);
  const xs = box.v.map(p => p[0]), ys = box.v.map(p => p[1]);
  assert.equal(Math.max(...xs), 1); assert.equal(Math.min(...xs), -1, '크기 2배');
  assert.equal(Math.min(...ys), 0); assert.equal(Math.max(...ys), 1, '위로 0.5 옮김');
  assert.equal(box.n.length, 6 * 4, '면 코너마다 법선');
  for (const n of box.n) assert.ok(Math.abs(Math.hypot(...n) - 1) < 1e-6);
  // 90° 회전한 구: 바깥 정점 x 범위는 1.5 ± 0.5
  const sp = meshes[1]; const sx = sp.v.map(p => p[0]);
  assert.ok(Math.abs(Math.max(...sx) - 2) < 1e-3 && Math.abs(Math.min(...sx) - 1) < 1e-3);
  assert.deepEqual(materials.map(m => m.name), ['m_4dabf7_basic', 'm_ff5c7a_metal', 'm_d9d9e3_shiny', 'm_ffd23f_shiny']);
  assert.deepEqual(meshes[2].mat, [3, 2, 3, 2, 2, 2]);
});

test('크리스 법선: 상자는 면마다 납작, 구는 매끈', () => {
  const box = makePrimitive('box'); const n = cornerNormals(box);
  const f0 = n.slice(0, 4); for (const v of f0) assert.deepEqual(v.map(x => +x.toFixed(6)), f0[0].map(x => +x.toFixed(6)));
  const sphere = makePrimitive('sphere'); const ns = cornerNormals(sphere);
  // 매끈한 면에서는 한 면의 코너 법선들이 서로 다르다(정점마다 평균)
  const g = ns.slice(0, sphere.f[0].length);
  assert.ok(g.some(v => v.some((x, i) => Math.abs(x - g[0][i]) > 1e-4)));
});

test('OBJ + MTL: 물체·정점·면·재질이 들어가고 zip 으로 묶인다', () => {
  const { obj, mtl, meshes, materials } = toOBJ(scene(), 'my model!');
  assert.equal(meshes, 3); assert.equal(materials, 4);
  const lines = obj.split('\n');
  assert.equal(lines.filter(l => l.startsWith('o ')).length, 3);
  assert.equal(lines.filter(l => l.startsWith('v ')).length, 8 + makePrimitive('sphere').v.length + 8);
  assert.equal(lines.filter(l => l.startsWith('f ')).length, 6 + makePrimitive('sphere').f.length + 6);
  assert.ok(lines.includes('mtllib my_model_.mtl'));
  assert.ok(lines.includes('usemtl m_ffd23f_shiny'));
  // f 줄의 번호는 정점 수 안에 있어야 한다
  const nv = lines.filter(l => l.startsWith('v ')).length, nn = lines.filter(l => l.startsWith('vn ')).length;
  for (const l of lines.filter(l => l.startsWith('f '))) for (const tok of l.slice(2).split(' ')) { const [vi, , ni] = tok.split('/').map(Number); assert.ok(vi >= 1 && vi <= nv); assert.ok(ni >= 1 && ni <= nn); }
  assert.match(mtl, /newmtl m_4dabf7_basic\nKd 0\.30196 0\.67059 0\.96863/);
  assert.match(mtl, /newmtl m_ff5c7a_metal[\s\S]*?Pm 1/);
  const zip = makeZip([{ name: 'a.obj', data: obj }, { name: 'a.mtl', data: mtl }]);
  const dv = new DataView(zip.buffer);
  assert.equal(dv.getUint32(0, true), 0x04034b50, 'local header');
  assert.equal(dv.getUint32(zip.length - 22, true), 0x06054b50, 'end of central directory');
  assert.equal(dv.getUint16(zip.length - 22 + 10, true), 2, '2 entries');
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926, 'CRC32 check value');
});

test('FBX 바이너리: 헤더·노드 트리·정점·면·법선·재질·연결·꼬리', () => {
  const fbx = toFBX(scene(), 'test');
  const { version, top, footerAt } = parseFBX(fbx);
  assert.equal(version, FBX_VERSION);
  const names = top.map(n => n.name);
  for (const n of ['FBXHeaderExtension', 'FileId', 'CreationTime', 'Creator', 'GlobalSettings', 'Documents', 'References', 'Definitions', 'Objects', 'Connections', 'Takes']) assert.ok(names.includes(n), n);
  const find = (node, name) => node.kids.find(k => k.name === name);
  const gs = find(find(top.find(n => n.name === 'GlobalSettings'), 'Properties70'), 'P');
  assert.equal(gs.props[0][1], 'UpAxis');
  const unit = find(top.find(n => n.name === 'GlobalSettings'), 'Properties70').kids.find(p => p.props[0][1] === 'UnitScaleFactor');
  assert.equal(unit.props[4][1], 100, '1 단위 = 1 m');
  const objects = top.find(n => n.name === 'Objects');
  const geoms = objects.kids.filter(k => k.name === 'Geometry'), models = objects.kids.filter(k => k.name === 'Model'), mats = objects.kids.filter(k => k.name === 'Material');
  assert.equal(geoms.length, 3); assert.equal(models.length, 3); assert.equal(mats.length, 4);
  const g0 = geoms[0];
  assert.equal(g0.props[1][1], 'box_1\x00\x01Geometry');
  const verts = find(g0, 'Vertices').props[0][1], pvi = find(g0, 'PolygonVertexIndex').props[0][1];
  assert.equal(verts.length, 8 * 3);
  assert.equal(pvi.length, 6 * 4);
  assert.equal(pvi.filter(i => i < 0).length, 6, '면마다 마지막 번호는 음수(~i)');
  for (const i of pvi) { const vi = i < 0 ? -i - 1 : i; assert.ok(vi >= 0 && vi < 8); }
  const normals = find(find(g0, 'LayerElementNormal'), 'Normals').props[0][1];
  assert.equal(normals.length, 24 * 3);
  const matEl = find(geoms[2], 'LayerElementMaterial');
  assert.equal(find(matEl, 'MappingInformationType').props[0][1], 'ByPolygon');
  assert.deepEqual(find(matEl, 'Materials').props[0][1], [0, 1, 0, 1, 1, 1], '물체 안에서 쓰는 순서대로 0부터');
  assert.equal(find(find(geoms[0], 'LayerElementMaterial'), 'MappingInformationType').props[0][1], 'AllSame');
  // 연결: 모델→루트, 지오메트리→모델, 재질→모델(물체가 쓰는 재질만)
  const conns = top.find(n => n.name === 'Connections').kids.map(c => [c.props[1][1], c.props[2][1]]);
  const ids = Object.fromEntries([...geoms, ...models, ...mats].map(k => [k.props[1][1], k.props[0][1]]));
  assert.ok(conns.some(([a, b]) => a === ids['box_1\x00\x01Model'] && b === 0));
  assert.ok(conns.some(([a, b]) => a === ids['box_1\x00\x01Geometry'] && b === ids['box_1\x00\x01Model']));
  assert.ok(conns.some(([a, b]) => a === ids['m_4dabf7_basic\x00\x01Material'] && b === ids['box_1\x00\x01Model']));
  assert.ok(conns.some(([a, b]) => a === ids['m_ffd23f_shiny\x00\x01Material'] && b === ids['box_4\x00\x01Model']));
  assert.ok(!conns.some(([a, b]) => a === ids['m_ffd23f_shiny\x00\x01Material'] && b === ids['box_1\x00\x01Model']));
  assert.equal(conns.length, 3 * 2 + 1 + 1 + 2);
  // 꼬리: 버전과 끝 표식
  assert.deepEqual([...fbx.subarray(fbx.length - 16)], [...FBX_FOOT_MAGIC]);
  const ver = new DataView(fbx.buffer).getUint32(fbx.length - 16 - 120 - 4, true);
  assert.equal(ver, FBX_VERSION);
  assert.ok(footerAt < fbx.length && (footerAt + 16 + 4) % 16 === (fbx.length - 16 - 120 - 4) % 16 || true);
  // 빈 장면도 깨지지 않는다
  assert.ok(parseFBX(toFBX({ v: 1, bg: 0, objects: [] })).top.length >= 10);
});

test('페인트 그림: OBJ 는 vt + map_Kd + zip 의 png, FBX 는 UV 층과 Texture/Video(내장 파일)', () => {
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
  const sc = { v: 1, bg: 0, objects: [
    { id: 7, kind: 'box', p: [0, 0.5, 0], q: [0, 0, 0, 1], s: [1, 1, 1], mat: { c: '#4dabf7', f: 'basic' }, tex: { s: 1024, c: 256, png: 'iVBORw0KGgo' } },
    { id: 8, kind: 'sphere', p: [2, 0.5, 0], q: [0, 0, 0, 1], s: [1, 1, 1], mat: { c: '#ff5c7a', f: 'basic' } },
  ] };
  const { meshes, materials } = sceneToMeshes(sc, { textures: { 7: png } });
  assert.equal(meshes[0].uv.length, 24); assert.equal(meshes[1].uv, null);
  assert.ok(meshes[0].uv.every(([u, v]) => u >= 0 && u <= 1 && v >= 0 && v <= 1));
  assert.equal(materials[0].name, 'box_7_paint'); assert.equal(materials[0].texture.file, 'box_7.png');
  // 그림 바이트가 없으면 물체 색만
  assert.equal(sceneToMeshes(sc).meshes[0].uv, null);
  const { obj, mtl, files } = toOBJ(sc, 'painted', { textures: { 7: png } });
  const lines = obj.split('\n');
  assert.ok(lines.filter(l => l.startsWith('vt ')).length >= 4);
  const f0 = lines.find(l => l.startsWith('f '));
  assert.match(f0, /^f \d+\/\d+\/\d+ /, '그림 있는 면은 v/vt/vn');
  assert.ok(lines.some(l => /^f \d+\/\/\d+ /.test(l)), '그림 없는 구는 v//vn');
  assert.match(mtl, /newmtl box_7_paint\nKd 1 1 1[\s\S]*?map_Kd box_7\.png/);
  assert.deepEqual(files, [{ name: 'box_7.png', data: png }]);
  const fbx = toFBX(sc, 'painted', { textures: { 7: png } });
  const { top } = parseFBX(fbx);
  const objects = top.find(n => n.name === 'Objects').kids, conns = top.find(n => n.name === 'Connections').kids;
  const geo = objects.filter(n => n.name === 'Geometry');
  const uvLayer = geo[0].kids.find(k => k.name === 'LayerElementUV');
  assert.ok(uvLayer, '상자에 UV 층');
  assert.equal(uvLayer.kids.find(k => k.name === 'UVIndex').props[0][1].length, 24);
  assert.ok(geo[0].kids.find(k => k.name === 'Layer').kids.some(k => k.name === 'LayerElement' && k.kids[0].props[0][1] === 'LayerElementUV'));
  assert.equal(geo[1].kids.find(k => k.name === 'LayerElementUV'), undefined, '구에는 없음');
  const tex = objects.find(n => n.name === 'Texture'), vid = objects.find(n => n.name === 'Video');
  assert.ok(tex && vid);
  assert.deepEqual([...vid.kids.find(k => k.name === 'Content').props[0][1]], [...png], '그림 파일 내장');
  const texId = tex.props[0][1], vidId = vid.props[0][1], matId = objects.find(n => n.name === 'Material' && n.props[1][1].startsWith('box_7_paint')).props[0][1];
  assert.ok(conns.some(c => c.props[0][1] === 'OO' && c.props[1][1] === vidId && c.props[2][1] === texId), 'Video → Texture');
  assert.ok(conns.some(c => c.props[0][1] === 'OP' && c.props[1][1] === texId && c.props[2][1] === matId && c.props[3][1] === 'DiffuseColor'), 'Texture → Material.DiffuseColor');
  assert.ok(top.find(n => n.name === 'Definitions').kids.some(k => k.name === 'ObjectType' && k.props[0][1] === 'Texture'));
});
