import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makePrimitive, PRIMITIVE_KINDS } from '../shared/primitives.js';
import { pmEdges, pmValidate, pmSignedVolume, pmFaceNormal, pmFaceCenter, pmVertexNormals, pmNeighbors, pmToJSON, pmFromJSON, pmRenderBuffers, pmFlipX, pmBounds, pmStats, edgeKey } from '../shared/polymesh.js';
import { b64 } from '../shared/scene.js';

const nonManifold = pm => pmEdges(pm).list.filter(e => e.faces.length !== 2).length;

test('기본 도형 14종: 유효하고 닫혀 있고 바깥을 향한다(보통·촘촘 모두)', () => {
  for (const hd of [false, true]) for (const kind of PRIMITIVE_KINDS) {
    const pm = makePrimitive(kind, hd);
    const v = pmValidate(pm);
    assert.ok(v.ok, `${kind} ${v.errors[0] || ''}`);
    assert.equal(nonManifold(pm), 0, `${kind} 열린 모서리`);
    assert.ok(pmSignedVolume(pm) > 0, `${kind} 부피 부호`);
    if (!['torus', 'star', 'heart'].includes(kind)) pm.f.forEach((_, fi) => { const n = pmFaceNormal(pm, fi), c = pmFaceCenter(pm, fi); assert.ok(n[0] * c[0] + n[1] * c[1] + n[2] * c[2] > -1e-9, `${kind} 면 ${fi} 안쪽`); });
  }
});

test('치수: 상자 1·공 r0.5·캡슐 높이 1.2·판 두께 0.12·찰흙 r0.6', () => {
  const size = pm => { const b = pmBounds(pm); return b.max.map((x, i) => +(x - b.min[i]).toFixed(3)); };
  assert.deepEqual(size(makePrimitive('box')), [1, 1, 1]);
  assert.deepEqual(size(makePrimitive('sphere')), [1, 1, 1]);
  assert.deepEqual(size(makePrimitive('capsule')), [0.6, 1.2, 0.6]);
  assert.deepEqual(size(makePrimitive('slab')), [1, 0.12, 1]);
  assert.deepEqual(size(makePrimitive('clay')), [1.2, 1.2, 1.2]);
  assert.equal(pmStats(makePrimitive('box')).faces, 6);
  assert.equal(makePrimitive('cylinder').f.filter(f => f.length === 32).length, 2, '원기둥 뚜껑은 32각형 두 장');
});

test('모서리·이웃·법선', () => {
  const box = makePrimitive('box');
  const E = pmEdges(box);
  assert.equal(E.list.length, 12);
  assert.equal(E.index.get(edgeKey(box.f[0][0], box.f[0][1])), E.index.get(edgeKey(box.f[0][1], box.f[0][0])), '모서리 키는 방향 무관');
  assert.ok(pmNeighbors(box).every(n => n.length === 3));
  const vn = pmVertexNormals(box);
  assert.equal(vn.length, 24);
  for (let i = 0; i < 8; i++) { const p = box.v[i]; assert.ok(vn[i * 3] * p[0] + vn[i * 3 + 1] * p[1] + vn[i * 3 + 2] * p[2] > 0.8, '정점 법선은 모서리 바깥쪽'); }
});

test('저장 포맷 왕복 + 옛 삼각형 포맷 읽기 + 좌우 뒤집기', () => {
  const pm = makePrimitive('cylinder');
  const j = pmToJSON(pm);
  const back = pmFromJSON(j);
  assert.equal(back.v.length, pm.v.length); assert.equal(back.f.length, pm.f.length);
  assert.deepEqual(back.f[0], pm.f[0]);
  // 옛 포맷: 삼각형 두 개짜리 정사각형(공유 정점은 합쳐진다)
  const pos = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0]);
  const legacy = pmFromJSON({ pos: b64.fromF32(pos), idx: null });
  assert.equal(legacy.v.length, 4); assert.equal(legacy.f.length, 2);
  const flipped = pmFlipX(pm);
  assert.ok(pmSignedVolume(flipped) > 0, '뒤집어도 바깥 방향 유지');
  assert.equal(flipped.v[0][0], -pm.v[0][0]);
});

test('렌더 버퍼: 사각형은 2삼각형, n각형은 부채꼴, 각진 모서리는 법선이 갈라진다', () => {
  const box = makePrimitive('box');
  const rb = pmRenderBuffers(box);
  assert.equal(rb.triFace.length, 12);
  assert.equal(rb.position.length, 12 * 3 * 3);
  // 상자 꼭짓점 하나의 세 모퉁이 법선은 서로 다른 축을 향한다(크리스 32° 보다 많이 꺾임)
  const axes = new Set();
  for (let i = 0; i < rb.cornerVertex.length; i++) if (rb.cornerVertex[i] === 0) axes.add([rb.normal[i * 3], rb.normal[i * 3 + 1], rb.normal[i * 3 + 2]].map(x => Math.round(x)).join(','));
  assert.equal(axes.size, 3);
  const cyl = makePrimitive('cylinder');
  const rc = pmRenderBuffers(cyl);
  assert.equal(rc.triFace.length, 32 * 2 + 32 * 2, '옆 32사각형 + 뚜껑 32각형 2장(부채꼴)');
  assert.ok([...rc.cornerVertex].includes(-1), 'n각형 중심점');
  // 옆면 법선은 매끈(이웃 옆면과 섞임): 수평 성분만, y 성분 0
  const sideTri = [...rc.triFace].findIndex(fi => cyl.f[fi].length === 4);
  assert.ok(Math.abs(rc.normal[sideTri * 9 + 1]) < 1e-6);
  // update: 정점을 옮기면 위치 버퍼가 따라온다
  cyl.v[0][1] += 1; rc.update(cyl);
  const corner = [...rc.cornerVertex].indexOf(0);
  assert.equal(rc.position[corner * 3 + 1], cyl.v[0][1]);
});
