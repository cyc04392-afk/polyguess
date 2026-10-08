import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makePrimitive } from '../shared/primitives.js';
import { pmRenderBuffers, pmFaceNormal, pmFlipX, pmEdges } from '../shared/polymesh.js';
import { insetFaces, extrudeFaces, loopCut, edgeRing } from '../shared/meshops.js';
import { chartLayout, makeLayout, layoutFits, faceCharts, chartPixel, chartPoint, chartHeight, cornerUVs, polygonUVs, chartAffine, invertAffine, applyAffine, sameChart, nearestFaces, TEX_SIZES } from '../shared/uvcharts.js';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

test('배치: 면 수보다 칸이 넉넉하고(1.3배), 칸은 4~256px, 면이 아주 많으면 2048', () => {
  const box = chartLayout(6);
  assert.equal(box.size, 1024); assert.equal(box.cell, 256); assert.equal(box.cap, 16);
  const sphere = chartLayout(640);
  assert.ok(sphere.cap >= 640 * 1.3 - 30 && layoutFits(sphere, 640) && sphere.cell >= 30);
  const huge = chartLayout(120000);
  assert.equal(huge.size, 2048); assert.ok(layoutFits(huge, 120000)); assert.ok(huge.cell >= 4);
  assert.ok(TEX_SIZES.includes(huge.size));
  assert.equal(makeLayout(1024, 100).cols, 10);
});

test('면 차트: 투영한 꼭짓점이 전부 자기 칸 안(여백 안쪽)에 들어가고, 되돌리기 왕복이 맞다', () => {
  for (const kind of ['box', 'sphere', 'torus', 'prism6', 'heart']) {
    const pm = makePrimitive(kind), L = chartLayout(pm.f.length), charts = faceCharts(pm, L);
    pm.f.forEach((face, fi) => {
      const ch = charts[fi];
      assert.equal(ch.cx, (fi % L.cols) * L.cell); assert.equal(ch.cy, Math.floor(fi / L.cols) * L.cell);
      for (const vi of face) {
        const [x, y] = chartPixel(ch, pm.v[vi]);
        assert.ok(x >= ch.cx + L.pad - 1e-6 && x <= ch.cx + L.cell - L.pad + 1e-6, `${kind} face ${fi} x ${x}`);
        assert.ok(y >= ch.cy + L.pad - 1e-6 && y <= ch.cy + L.cell - L.pad + 1e-6, `${kind} face ${fi} y ${y}`);
        const back = chartPoint(ch, x, y);
        for (let k = 0; k < 3; k++) assert.ok(near(back[k], pm.v[vi][k], 1e-6), '평면 위 점은 그대로 돌아온다');
        assert.ok(near(chartHeight(ch, pm.v[vi]), 0, 1e-6), '꼭짓점은 면 평면 위');
      }
    });
  }
});

test('코너 UV: 렌더 버퍼의 코너마다 0~1 안, 다각형 중심점(-1)은 면 UV 의 평균', () => {
  const pm = makePrimitive('prism6'), L = chartLayout(pm.f.length), charts = faceCharts(pm, L), b = pmRenderBuffers(pm);
  const uv = cornerUVs(pm, charts, L, b.cornerVertex, b.triFace);
  assert.equal(uv.length, b.cornerVertex.length * 2);
  for (let i = 0; i < uv.length; i++) assert.ok(uv[i] >= 0 && uv[i] <= 1);
  const ci = [...b.cornerVertex].findIndex(v => v < 0);
  assert.ok(ci >= 0, '육각 면은 중심점을 쓴다');
  const fi = b.triFace[(ci / 3) | 0], face = pm.f[fi];
  const avg = face.reduce((a, vi) => { const [x, y] = chartPixel(charts[fi], pm.v[vi]); return [a[0] + x / face.length, a[1] + y / face.length]; }, [0, 0]);
  assert.ok(near(uv[ci * 2] * L.size, avg[0], 1e-4) && near(uv[ci * 2 + 1] * L.size, avg[1], 1e-4));
  const poly = polygonUVs(pm, charts, L, true);
  assert.equal(poly.length, pm.f.reduce((a, f) => a + f.length, 0));
  assert.ok(near(poly[0][1], 1 - chartPixel(charts[0], pm.v[pm.f[0][0]])[1] / L.size));
});

test('아핀 변환: 인셋으로 나뉜 면의 칸 픽셀이 원래 면의 칸에서 같은 3D 자리로 간다(루프 자르기도)', () => {
  const box = makePrimitive('box'), L = chartLayout(6), C0 = faceCharts(box, L);
  const top = box.f.findIndex((_, fi) => pmFaceNormal(box, fi)[1] > 0.9);
  const r = insetFaces(box, [top], { thickness: 0.2 });
  const C1 = faceCharts(r.pm, L);
  r.pm.f.forEach((face, fi) => {
    const o = r.faceOrigin[fi]; if (o !== top) return;
    const m = chartAffine(C1[fi], C0[o]);
    assert.ok(invertAffine(m), '같은 평면이면 뒤집을 수 있다');
    for (const vi of face) {
      const d = chartPixel(C1[fi], r.pm.v[vi]), s = applyAffine(m, d[0], d[1]), expect = chartPixel(C0[o], r.pm.v[vi]);
      assert.ok(near(s[0], expect[0], 1e-6) && near(s[1], expect[1], 1e-6));
    }
  });
  const E = pmEdges(box), ring = edgeRing(box, E, 0), cut = loopCut(box, ring, 1, 0), C2 = faceCharts(cut.pm, L);
  cut.pm.f.forEach((face, fi) => {
    const o = cut.faceOrigin[fi], m = chartAffine(C2[fi], C0[o]);
    for (const vi of face) { const d = chartPixel(C2[fi], cut.pm.v[vi]), s = applyAffine(m, d[0], d[1]), e = chartPixel(C0[o], cut.pm.v[vi]); assert.ok(near(s[0], e[0], 1e-6) && near(s[1], e[1], 1e-6)); }
  });
});

test('밀어내기 옆면(원래 면과 직각)은 특이 변환 → null, 안 바뀐 면은 sameChart', () => {
  const box = makePrimitive('box'), L = chartLayout(6), C0 = faceCharts(box, L);
  const top = box.f.findIndex((_, fi) => pmFaceNormal(box, fi)[1] > 0.9);
  const r = extrudeFaces(box, [top], 0.4), C1 = faceCharts(r.pm, L);
  for (const fi of r.sides) assert.equal(invertAffine(chartAffine(C1[fi], C0[r.faceOrigin[fi]])), null);
  assert.ok(invertAffine(chartAffine(C1[top], C0[top])), '위로 올라간 윗면은 평행 이동이라 괜찮다');
  r.pm.f.forEach((_, fi) => { if (fi !== top && r.faceOrigin[fi] === fi) assert.ok(sameChart(C1[fi], C0[fi])); });
  assert.equal(sameChart(C1[top], C0[top]), false, '윗면은 움직였다');
});

test('좌우 뒤집기: pointMap 으로 거울상 점을 원래 면 칸에 맞춘다', () => {
  const heart = makePrimitive('heart'), L = chartLayout(heart.f.length), C0 = faceCharts(heart, L);
  const flipped = pmFlipX(heart), C1 = faceCharts(flipped, L);
  const mirror = p => [-p[0], p[1], p[2]];
  flipped.f.forEach((face, fi) => {
    const m = chartAffine(C1[fi], C0[fi], mirror);
    for (const vi of face) { const d = chartPixel(C1[fi], flipped.v[vi]), s = applyAffine(m, d[0], d[1]), e = chartPixel(C0[fi], mirror(flipped.v[vi])); assert.ok(near(s[0], e[0], 1e-5) && near(s[1], e[1], 1e-5)); }
  });
});

test('면 대응을 모르면 가장 가까운 면: 상자 → 촘촘한 상자의 윗면 칸은 전부 윗면', () => {
  const box = makePrimitive('box'), hd = makePrimitive('box', true);
  const top = box.f.findIndex((_, fi) => pmFaceNormal(box, fi)[1] > 0.9);
  const o = nearestFaces(box, hd);
  const topHd = hd.f.map((_, fi) => fi).filter(fi => pmFaceNormal(hd, fi)[1] > 0.9);
  assert.equal(topHd.length, 400);
  assert.ok(topHd.every(fi => o[fi] === top));
});
