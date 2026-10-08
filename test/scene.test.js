import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeScene, sanitizeObject, emptyScene, b64, SCENE_LIMITS } from '../shared/scene.js';

const prim = (over = {}) => ({ id: 1, kind: 'box', p: [0, 0.5, 0], q: [0, 0, 0, 1], s: [1, 1, 1], mat: { c: '#FF5C7A', f: 'shiny' }, ...over });

test('빈/이상한 입력은 빈 장면', () => {
  assert.deepEqual(sanitizeScene(null), emptyScene());
  assert.deepEqual(sanitizeScene({ objects: 'x' }), emptyScene());
});

test('기본 도형: 색은 소문자로, 모르는 재질은 기본으로, 범위를 벗어난 위치는 잘라낸다', () => {
  const o = sanitizeObject(prim({ p: [5000, -0.2, 1], mat: { c: '#FF5C7A', f: 'laser' } }));
  assert.equal(o.mat.c, '#ff5c7a');
  assert.equal(o.mat.f, 'basic');
  assert.equal(o.p[0], 1000);
  assert.equal(sanitizeObject(prim({ kind: 'dragon' })), null);
});

test('회전은 단위 길이로 정규화', () => {
  const o = sanitizeObject(prim({ q: [0, 2, 0, 0] }));
  assert.deepEqual(o.q, [0, 1, 0, 0]);
});

test('크기는 0.01~200 사이로 잘라낸다', () => {
  const o = sanitizeObject(prim({ s: [-1.5, 0, 300] }));
  assert.deepEqual(o.s, [0.01, 0.01, 200]);
});

test('소품은 더 이상 없다: 모르는 종류는 버린다', () => {
  assert.equal(sanitizeObject(prim({ kind: 'prop', prop: 'tree' })), null);
});

test('메시: base64 정점/인덱스 왕복, 잘못된 인덱스는 거부', () => {
  const pos = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]);
  const idx = new Uint32Array([0, 1, 2, 0, 2, 3]);
  const o = sanitizeObject(prim({ kind: 'mesh', mesh: { pos: b64.fromF32(pos), idx: b64.fromU32(idx) } }));
  assert.ok(o);
  assert.deepEqual([...b64.toF32(o.mesh.pos)], [...pos]);
  assert.deepEqual([...b64.toU32(o.mesh.idx)], [...idx]);
  assert.equal(sanitizeObject(prim({ kind: 'mesh', mesh: { pos: b64.fromF32(pos), idx: b64.fromU32(new Uint32Array([0, 1, 9])) } })), null, '범위 밖 인덱스');
  assert.equal(sanitizeObject(prim({ kind: 'mesh', mesh: { pos: b64.fromF32(new Float32Array([0, 0, 0, 1])) } })), null, '정점 수가 3의 배수 아님');
  assert.equal(sanitizeObject(prim({ kind: 'mesh', mesh: { pos: 'not base64 !!!' } })), null);
});

test('장면: 개수 제한, 중복 id 제거, 배경 범위', () => {
  const objects = Array.from({ length: SCENE_LIMITS.objects + 10 }, (_, i) => prim({ id: i + 1 }));
  objects.push(prim({ id: 1 }));
  const s = sanitizeScene({ bg: 99, objects });
  assert.equal(s.objects.length, SCENE_LIMITS.objects);
  assert.equal(s.bg, 20);
  assert.equal(sanitizeScene({ objects: [prim({ id: 3 }), prim({ id: 3 })] }).objects.length, 1);
});

test('다각형 메시 포맷(pos/fv/fn)과 옛 삼각형 포맷을 모두 받고, 깨진 것은 버린다', async () => {
  const { sanitizeObject, b64 } = await import('../shared/scene.js');
  const pos = b64.fromF32(new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]));
  const base = { id: 1, kind: 'mesh', p: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1], mat: { c: '#ffffff', f: 'basic' } };
  const quad = sanitizeObject({ ...base, mesh: { pos, fv: b64.fromU32(new Uint32Array([0, 1, 2, 3])), fn: b64.fromU8([4]) } });
  assert.ok(quad && quad.mesh.fv && quad.mesh.fn, '다각형 포맷 통과');
  assert.equal(sanitizeObject({ ...base, mesh: { pos, fv: b64.fromU32(new Uint32Array([0, 1, 2, 9])), fn: b64.fromU8([4]) } }), null, '범위 밖 번호');
  assert.equal(sanitizeObject({ ...base, mesh: { pos, fv: b64.fromU32(new Uint32Array([0, 1, 2])), fn: b64.fromU8([4]) } }), null, '개수 불일치');
  assert.equal(sanitizeObject({ ...base, mesh: { pos, fv: b64.fromU32(new Uint32Array([0, 1])), fn: b64.fromU8([2]) } }), null, '면은 3개 이상');
  const legacy = sanitizeObject({ ...base, mesh: { pos, idx: b64.fromU32(new Uint32Array([0, 1, 2, 0, 2, 3])) } });
  assert.ok(legacy && legacy.mesh.idx && !legacy.mesh.fv, '옛 포맷은 그대로 통과');
});

test('광원: 종류·세기·각도를 범위 안으로 맞추고, 4개까지만', async () => {
  const { sanitizeObject, sanitizeScene } = await import('../shared/scene.js');
  const l = sanitizeObject({ id: 1, kind: 'light', p: [0, 3, 0], s: [5, 5, 5], light: { type: 'spot', i: 99, a: 5 } });
  assert.deepEqual(l.light, { type: 'spot', i: 6, a: 10 });
  assert.deepEqual(l.s, [1, 1, 1], '광원은 크기를 쓰지 않는다');
  assert.equal(sanitizeObject({ id: 2, kind: 'light' }).light.type, 'sun');
  const many = sanitizeScene({ objects: Array.from({ length: 6 }, (_, i) => ({ id: i + 1, kind: 'light', light: { type: 'point' } })) });
  assert.equal(many.objects.length, 4);
});

test('페인트 그림(tex): 크기·칸·PNG 모양을 검사하고, 통과하면 옛 paint 는 버린다', async () => {
  const { sanitizeTex, stripTex, SCENE_LIMITS } = await import('../shared/scene.js');
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  assert.deepEqual(sanitizeTex({ s: 1024, c: 256, png }), { s: 1024, c: 256, png });
  assert.equal(sanitizeTex({ s: 1000, c: 256, png }), null, '크기는 256·512·1024·2048 만');
  assert.equal(sanitizeTex({ s: 1024, c: 1, png }), null);
  assert.equal(sanitizeTex({ s: 1024, c: 4096, png }), null);
  assert.equal(sanitizeTex({ s: 1024, c: 16, png: 'aGVsbG8=' }), null, 'PNG 가 아니면');
  assert.equal(sanitizeTex({ s: 1024, c: 16, png: png + '<script>' }), null);
  assert.equal(sanitizeTex({ s: 1024, c: 16, png: 'iVBORw0KGgo' + 'A'.repeat(SCENE_LIMITS.texChars) }), null, '너무 크면');
  const f = new Uint8Array(6); f[1] = 1;
  const o = sanitizeObject(prim({ tex: { s: '512', c: 8.2, png }, paint: { pal: ['#abcdef'], f: b64.fromU8(f) } }));
  assert.deepEqual(o.tex, { s: 512, c: 8, png }); assert.equal(o.paint, undefined, '그림이 있으면 옛 면 색칠은 안 쓴다');
  const bad = sanitizeObject(prim({ tex: { s: 512, c: 8, png: 'nope' }, paint: { pal: ['#abcdef'], f: b64.fromU8(f) } }));
  assert.equal(bad.tex, undefined); assert.deepEqual(bad.paint.pal, ['#abcdef'], '그림이 깨졌으면 옛 면 색칠이라도');
  const sc = { v: 1, bg: 0, objects: [o, prim({ id: 2 })] };
  const st = stripTex(sc);
  assert.equal(st.objects[0].tex, undefined); assert.equal(st.objects[1], sc.objects[1]); assert.ok(sc.objects[0].tex, '원본은 그대로');
  assert.equal(stripTex({ v: 1, bg: 0, objects: [prim()] }).objects.length, 1);
});
