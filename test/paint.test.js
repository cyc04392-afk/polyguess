import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makePrimitive } from '../shared/primitives.js';
import { pmFaceNormal } from '../shared/polymesh.js';
import { insetFaces } from '../shared/meshops.js';
import { makePaint, paintColorIndex, faceColor, trimPalette, paintToJSON, paintFromJSON, remapPaint, transferPaint, isPainted, PAINT_MAX_COLORS } from '../shared/paint.js';
import { sanitizeObject, sanitizePaint, primitiveFaceCount, b64 } from '../shared/scene.js';

const box = () => makePrimitive('box');
const topFace = pm => pm.f.findIndex((_, fi) => pmFaceNormal(pm, fi)[1] > 0.9);

test('팔레트: 색은 1부터 번호, 같은 색은 재사용, 가득 차면 가장 비슷한 색', () => {
  const p = makePaint(6);
  assert.equal(paintColorIndex(p, '#FF0000'), 1);
  assert.equal(paintColorIndex(p, '#ff0000'), 1);
  assert.equal(paintColorIndex(p, '#00ff00'), 2);
  assert.equal(paintColorIndex(p, 'nope'), 0);
  for (let i = 0; i < PAINT_MAX_COLORS; i++) paintColorIndex(p, `#0000${(i + 10).toString(16).padStart(2, '0')}`);
  assert.equal(p.pal.length, PAINT_MAX_COLORS);
  assert.equal(paintColorIndex(p, '#fe0000'), 1, '가득 차면 빨강과 가장 비슷한 1번');
});

test('저장 포맷 왕복: 안 쓰는 색은 빠지고, 길이가 다르면 버린다', () => {
  const p = makePaint(6);
  const k = paintColorIndex(p, '#ff5c7a'); paintColorIndex(p, '#000000'); // 2번은 안 씀
  p.f[2] = k;
  assert.equal(isPainted(p), true);
  const j = paintToJSON(p);
  assert.deepEqual(j.pal, ['#ff5c7a']);
  const back = paintFromJSON(j, 6);
  assert.deepEqual([...back.f], [0, 0, 1, 0, 0, 0]);
  assert.equal(faceColor(back, 2), '#ff5c7a'); assert.equal(faceColor(back, 0), null);
  assert.equal(paintFromJSON(j, 7), null);
  assert.equal(paintToJSON(makePaint(6)), null, '칠한 면이 없으면 저장 안 함');
  assert.equal(trimPalette(null), null);
});

test('위상이 바뀌면 faceOrigin 으로 색을 옮긴다(인셋 띠는 원래 면 색)', () => {
  const b = box(), top = topFace(b);
  const p = makePaint(6); p.f[top] = paintColorIndex(p, '#2b8a3e');
  const r = insetFaces(b, [top], { thickness: 0.2 });
  const q = remapPaint(p, r.faceOrigin);
  assert.equal(q.f.length, 10);
  assert.equal(faceColor(q, top), '#2b8a3e');
  assert.ok(r.sides.every(fi => faceColor(q, fi) === '#2b8a3e'));
  assert.equal(remapPaint(makePaint(6), r.faceOrigin), null);
});

test('면 대응을 모르면 가장 가까운 면 중심에서 색을 가져온다(상자 → 촘촘한 상자)', () => {
  const b = box(), top = topFace(b), hd = makePrimitive('box', true);
  const p = makePaint(6); p.f[top] = paintColorIndex(p, '#e03131');
  const t = transferPaint(b, p, hd);
  assert.equal(t.f.length, hd.f.length);
  const topHd = hd.f.map((_, fi) => fi).filter(fi => pmFaceNormal(hd, fi)[1] > 0.9);
  assert.equal(topHd.length, 400);
  assert.ok(topHd.every(fi => t.f[fi] === 1), '윗면 400칸 전부 빨강');
  assert.equal([...t.f].filter(x => x === 1).length, 400, '다른 면은 그대로');
});

test('서버 검증: 면 수가 맞는 색칠만 통과, 범위 밖 번호는 0, 메시도 같은 규칙', () => {
  const f = new Uint8Array(6); f[1] = 1; f[2] = 9;
  const ok = sanitizePaint({ pal: ['#ABCDEF'], f: b64.fromU8(f) }, 6);
  assert.deepEqual(ok.pal, ['#abcdef']); assert.deepEqual([...b64.toU8(ok.f)], [0, 1, 0, 0, 0, 0]);
  assert.equal(sanitizePaint({ pal: ['#abcdef'], f: b64.fromU8(f) }, 5), null);
  assert.equal(sanitizePaint({ pal: [], f: b64.fromU8(f) }, 6), null);
  assert.equal(primitiveFaceCount('box'), 6); assert.equal(primitiveFaceCount('clay'), 3456); assert.equal(primitiveFaceCount('nope'), 0);
  const o = sanitizeObject({ id: 1, kind: 'box', p: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1], mat: { c: '#ffffff', f: 'basic' }, paint: { pal: ['#abcdef'], f: b64.fromU8(f) } });
  assert.deepEqual(o.paint.pal, ['#abcdef']);
  const bad = sanitizeObject({ id: 1, kind: 'sphere', p: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1], mat: { c: '#ffffff', f: 'basic' }, paint: { pal: ['#abcdef'], f: b64.fromU8(f) } });
  assert.equal(bad.paint, undefined);
  // 메시
  const pm = box();
  const pos = new Float32Array(pm.v.flat()), fv = new Uint32Array(pm.f.flat()), fn = new Uint8Array(pm.f.map(x => x.length));
  const m = sanitizeObject({ id: 2, kind: 'mesh', p: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1], mat: { c: '#ffffff', f: 'basic' }, mesh: { pos: b64.fromF32(pos), fv: b64.fromU32(fv), fn: b64.fromU8(fn) }, paint: { pal: ['#abcdef'], f: b64.fromU8(f) } });
  assert.deepEqual(m.paint.pal, ['#abcdef']);
});

test('가까운 면 옮기기: 납작한 판의 윗면도 가장자리 칸까지 전부 윗면 색(평면·법선 기준)', () => {
  const slab = makePrimitive('slab'), top = topFace(slab), hd = makePrimitive('slab', true);
  const p = makePaint(6); p.f[top] = paintColorIndex(p, '#2b8a3e');
  const t = transferPaint(slab, p, hd);
  const topHd = hd.f.map((_, fi) => fi).filter(fi => pmFaceNormal(hd, fi)[1] > 0.9);
  assert.equal(topHd.length, 400);
  assert.ok(topHd.every(fi => t.f[fi] === 1));
  assert.equal([...t.f].filter(x => x === 1).length, 400);
  // 공 → 촘촘한 공: 위쪽 절반 색이 위쪽 절반으로
  const sph = makePrimitive('sphere'), hs = makePrimitive('sphere', true);
  const q = makePaint(sph.f.length); const k = paintColorIndex(q, '#e03131');
  sph.f.forEach((_, fi) => { if (pmFaceNormal(sph, fi)[1] > 0.3) q.f[fi] = k; });
  const u = transferPaint(sph, q, hs);
  let wrong = 0; hs.f.forEach((_, fi) => { const up = pmFaceNormal(hs, fi)[1] > 0.35; const painted = u.f[fi] === k; if (up !== painted) wrong++; });
  assert.ok(wrong < hs.f.length * 0.05, `경계 근처 외에는 맞아야 함 (${wrong})`);
});
