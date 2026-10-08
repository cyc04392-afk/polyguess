import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makePrimitive, PRIMITIVE_KINDS } from '../shared/primitives.js';
import { pmEdges, pmValidate, pmSignedVolume, pmFaceNormal, pmFaceCenter, edgeKey } from '../shared/polymesh.js';
import { edgeRing, edgeLoop, loopCut, loopCutParams, bevelEdges, extrudeFaces, deleteFaces, edgesOfSelection } from '../shared/meshops.js';

const nonManifold = pm => pmEdges(pm).list.filter(e => e.faces.length !== 2).length;
const inward = pm => { let n = 0; pm.f.forEach((_, fi) => { const a = pmFaceNormal(pm, fi), c = pmFaceCenter(pm, fi); if (a[0] * c[0] + a[1] * c[1] + a[2] * c[2] < -1e-9) n++; }); return n; };
const good = (pm, name) => { const v = pmValidate(pm); assert.ok(v.ok, `${name}: ${v.errors[0]}`); assert.equal(nonManifold(pm), 0, `${name}: 열린 모서리`); assert.ok(pmSignedVolume(pm) > 0, `${name}: 부피`); };
const allEdges = E => E.list.map((_, i) => i);
const box = () => makePrimitive('box');
const topFace = pm => pm.f.findIndex((_, fi) => pmFaceNormal(pm, fi)[1] > 0.9);

test('루프 자르기용 링: 원기둥 세로 모서리는 닫힌 32바퀴, 가로 모서리는 뚜껑에서 멈추는 열린 링', () => {
  const cyl = makePrimitive('cylinder'), E = pmEdges(cyl);
  const vertical = E.list.findIndex(e => Math.abs(cyl.v[e.a][1] - cyl.v[e.b][1]) > 0.5);
  const ring = edgeRing(cyl, E, vertical);
  assert.equal(ring.closed, true); assert.equal(ring.edges.length, 32); assert.equal(ring.faces.length, 32);
  // a 쪽이 일관되게 정렬: 모든 a 는 같은 높이
  assert.ok(ring.edges.every(e => Math.abs(cyl.v[e.a][1] - cyl.v[ring.edges[0].a][1]) < 1e-9));
  const horizontal = E.list.findIndex(e => cyl.v[e.a][1] > 0.4 && cyl.v[e.b][1] > 0.4);
  const open = edgeRing(cyl, E, horizontal);
  assert.equal(open.closed, false); assert.equal(open.edges.length, 2); assert.equal(open.faces.length, 1);
  const torus = makePrimitive('torus'), Et = pmEdges(torus);
  assert.equal(edgeRing(torus, Et, 0).closed, true);
});

test('루프 자르기: 정점·면이 늘고 기존 번호는 유지, slide 로 위치가 움직인다', () => {
  const cyl = makePrimitive('cylinder'), E = pmEdges(cyl);
  const vertical = E.list.findIndex(e => Math.abs(cyl.v[e.a][1] - cyl.v[e.b][1]) > 0.5);
  const ring = edgeRing(cyl, E, vertical);
  const r = loopCut(cyl, ring, 2, 0);
  good(r.pm, 'loopcut');
  assert.equal(r.pm.v.length, cyl.v.length + 64); assert.equal(r.pm.f.length, cyl.f.length + 64);
  assert.deepEqual(r.pm.v.slice(0, cyl.v.length), cyl.v, '기존 정점 그대로');
  assert.equal(r.verts.length, 2); assert.equal(r.verts[0].length, 32); assert.equal(r.edges.length, 64);
  const ys = r.verts.map(row => +r.pm.v[row[0]][1].toFixed(4));
  assert.deepEqual(ys.slice().sort((a, b) => a - b), [-0.1667, 0.1667].map(x => +x.toFixed(4)));
  const slid = loopCut(cyl, ring, 1, 0.5);
  assert.equal(loopCutParams(1, 0.5)[0], 0.75);
  assert.notEqual(+slid.pm.v[slid.verts[0][0]][1].toFixed(3), 0);
  // 열린 링: 뚜껑 32각형이 33각형이 된다(새 점이 끼어듦)
  const horizontal = E.list.findIndex(e => cyl.v[e.a][1] > 0.4 && cyl.v[e.b][1] > 0.4);
  const o = loopCut(cyl, edgeRing(cyl, E, horizontal), 1, 0);
  good(o.pm, 'open loopcut');
  assert.equal(o.pm.f.filter(f => f.length === 33).length, 2);
});

test('선 한 바퀴 선택: 공 적도 32개, 원기둥 뚜껑 테두리 32개, 세로 모서리는 혼자', () => {
  const sph = makePrimitive('sphere'), E = pmEdges(sph);
  const eq = E.list.findIndex(e => Math.abs(sph.v[e.a][1]) < 1e-6 && Math.abs(sph.v[e.b][1]) < 1e-6);
  assert.equal(edgeLoop(sph, E, eq).length, 32);
  const cyl = makePrimitive('cylinder'), Ec = pmEdges(cyl);
  const rim = Ec.list.findIndex(e => cyl.v[e.a][1] > 0.4 && cyl.v[e.b][1] > 0.4);
  assert.equal(edgeLoop(cyl, Ec, rim).length, 32);
  const vertical = Ec.list.findIndex(e => Math.abs(cyl.v[e.a][1] - cyl.v[e.b][1]) > 0.5);
  assert.equal(edgeLoop(cyl, Ec, vertical).length, 1);
});

test('베벨: 상자 모서리 하나 → 띠 1 + 양 끝 5각형, 전체 → 6+12+8 면', () => {
  const b = box(), E = pmEdges(b);
  const one = bevelEdges(b, E, [0], { width: 0.1, segments: 1 });
  good(one.pm, 'bevel one'); assert.equal(inward(one.pm), 0);
  assert.equal(one.pm.f.length, 7); assert.equal(one.faces.length, 1);
  assert.deepEqual(one.pm.f.map(f => f.length).sort(), [4, 4, 4, 4, 4, 5, 5]);
  const all = bevelEdges(b, E, allEdges(E), { width: 0.1, segments: 1 });
  good(all.pm, 'bevel all'); assert.equal(inward(all.pm), 0);
  assert.equal(all.pm.f.length, 26); assert.equal(all.pm.v.length, 24); assert.equal(all.faces.length, 20);
  assert.ok(pmSignedVolume(all.pm) < 1 && pmSignedVolume(all.pm) > 0.9);
  const round = bevelEdges(b, E, allEdges(E), { width: 0.1, segments: 3 });
  good(round.pm, 'bevel s=3'); assert.equal(round.pm.f.length, 6 + 36 + 8);
  assert.ok(pmSignedVolume(round.pm) < pmSignedVolume(all.pm), '둥글수록 더 깎인다');
});

test('베벨: 부분 선택(윗면 둘레·인접 두 모서리)과 모든 도형 전체 베벨이 닫힌 메시를 유지한다', () => {
  const b = box(), E = pmEdges(b);
  const topE = edgesOfSelection(b, E, { mode: 'face', faces: [topFace(b)] });
  assert.equal(topE.length, 4);
  for (const segments of [1, 2, 3]) {
    const r = bevelEdges(b, E, topE, { width: 0.1, segments }); good(r.pm, 'top ' + segments); assert.equal(inward(r.pm), 0);
    const two = bevelEdges(b, E, [topE[0], topE[1]], { width: 0.1, segments }); good(two.pm, 'two ' + segments); assert.equal(inward(two.pm), 0);
  }
  for (const kind of PRIMITIVE_KINDS) {
    const pm = makePrimitive(kind), Ek = pmEdges(pm);
    const r = bevelEdges(pm, Ek, allEdges(Ek), { width: 0.02, segments: 2 });
    good(r.pm, kind);
  }
  // 점 선택 → 모서리: 점 하나면 닿은 모서리 3개, 이웃한 두 점이면 그 사이 1개
  assert.equal(edgesOfSelection(b, E, { mode: 'vert', verts: [0] }).length, 3);
  assert.equal(edgesOfSelection(b, E, { mode: 'vert', verts: [b.f[0][0], b.f[0][1]] }).length, 1);
  // 모서리가 없으면 그대로
  assert.equal(bevelEdges(b, E, [], { width: 0.1 }).pm.f.length, 6);
});

test('밀어내기: 윗면 하나는 면 4개 추가, 영역은 테두리만 복제, 지우기는 정점 정리', () => {
  const b = box(), top = topFace(b);
  const r = extrudeFaces(b, [top], 0.4);
  good(r.pm, 'extrude'); assert.equal(inward(r.pm), 0);
  assert.equal(r.pm.f.length, 10); assert.equal(r.pm.v.length, 12);
  assert.deepEqual(r.faces, [top]); assert.equal(r.sides.length, 4);
  assert.ok(Math.abs(pmSignedVolume(r.pm) - 1.4) < 1e-6);
  const sph = makePrimitive('sphere');
  const region = sph.f.map((_, i) => i).filter(i => pmFaceCenter(sph, i)[1] > 0.35);
  const rr = extrudeFaces(sph, region, 0.2);
  good(rr.pm, 'extrude region');
  assert.equal(rr.sides.length, 32, '테두리 32 모서리에만 옆면');
  assert.ok(rr.pm.v.length < sph.v.length + region.length * 2, '안쪽 정점은 복제하지 않는다');
  const d = deleteFaces(b, [top]);
  assert.equal(d.pm.f.length, 5); assert.equal(d.pm.v.length, 8);
  const d2 = deleteFaces(b, [0, 1, 2, 3, 4]);
  assert.equal(d2.pm.f.length, 1); assert.equal(d2.pm.v.length, 4, '안 쓰는 정점은 사라진다');
  assert.ok(pmValidate(d2.pm).ok);
});
