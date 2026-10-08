import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTimelapse, sanitizeTimelapse, timelapseScenes, applyFrame, pickEvenly, diffFrames, TIMELAPSE_LIMITS } from '../shared/timelapse.js';
import { emptyScene, sanitizeScene } from '../shared/scene.js';

const obj = (id, x = 0, c = '#ffffff') => ({ id, kind: 'box', p: [x, 0.5, 0], q: [0, 0, 0, 1], s: [1, 1, 1], mat: { c, f: 'basic' } });
const scene = (objects, bg = 0) => ({ v: 1, bg, objects });

test('고르게 고르기: 처음·끝 포함', () => {
  assert.deepEqual(pickEvenly(5, 10), [0, 1, 2, 3, 4]);
  assert.deepEqual(pickEvenly(11, 3), [0, 5, 10]);
  assert.deepEqual(pickEvenly(100, 2), [0, 99]);
});

test('차이 프레임: 바뀐 물체·지운 물체·배경만 담긴다', () => {
  const a = scene([obj(1), obj(2)]), b = scene([obj(1, 2), obj(2)]), c = scene([obj(1, 2)], 3);
  const f = diffFrames([a, b, c]);
  assert.equal(f[0].bg, 0); assert.equal(f[0].set.length, 2);
  assert.equal(f[1].bg, undefined); assert.deepEqual(f[1].set.map(o => o.id), [1]); assert.equal(f[1].del, undefined);
  assert.equal(f[2].bg, 3); assert.deepEqual(f[2].del, [2]); assert.equal(f[2].set, undefined);
  // 펼치면 원래 장면과 같다
  const back = timelapseScenes({ frames: f });
  assert.deepEqual(back[2].objects, c.objects); assert.equal(back[2].bg, 3);
});

test('타임랩스 만들기: 같은 스냅샷은 합치고, 2장 미만이면 null, 문자열 스냅샷도 받는다', () => {
  assert.equal(buildTimelapse([scene([])]), null);
  assert.equal(buildTimelapse([scene([]), JSON.stringify(scene([]))]), null);
  const tl = buildTimelapse([scene([]), JSON.stringify(scene([obj(1)])), scene([obj(1)]), scene([obj(1), obj(2, 1)])]);
  assert.equal(tl.n, 3); assert.equal(tl.frames.length, 3);
  assert.deepEqual(timelapseScenes(tl)[2].objects.map(o => o.id), [1, 2]);
});

test('너무 길면 고르게 솎고, 너무 크면 더 솎는다(처음·끝 유지)', () => {
  const snaps = []; for (let i = 0; i < 1000; i++) snaps.push(scene([obj(1, i)]));
  const tl = buildTimelapse(snaps);
  assert.equal(tl.n, 1000); assert.equal(tl.frames.length, TIMELAPSE_LIMITS.frames);
  const sc = timelapseScenes(tl);
  assert.equal(sc[0].objects[0].p[0], 0); assert.equal(sc[sc.length - 1].objects[0].p[0], 999);
  const small = buildTimelapse(snaps, { frames: 240, bytes: 4000, minFrames: 2 });
  assert.ok(small.frames.length < 240 && small.frames.length >= 2);
  assert.ok(JSON.stringify(small).length <= 4000 || small.frames.length === 2);
  assert.equal(timelapseScenes(small).at(-1).objects[0].p[0], 999);
});

test('서버 검증: 깨진 물체는 빠지고, 마지막은 완성 작품에 맞춰지며, 이상한 입력은 null', () => {
  const final = sanitizeScene(scene([obj(1, 2, '#ff0000'), obj(3)], 2));
  const tl = { v: 1, n: 3, frames: [{ bg: 0, set: [obj(1), { id: 2, kind: 'dragon' }] }, { set: [obj(1, 1)] }] };
  const ok = sanitizeTimelapse(tl, final);
  assert.ok(ok);
  assert.equal(ok.frames[0].set.length, 1, '모르는 종류는 빠짐');
  assert.equal(ok.frames.length, 3, '완성 작품과 다르면 맞추는 프레임 추가');
  const last = timelapseScenes(ok).at(-1);
  assert.deepEqual(last, { v: 1, bg: 2, objects: final.objects });
  // 이미 완성과 같으면 추가 없음
  const same = sanitizeTimelapse({ v: 1, frames: [{ bg: 2, set: final.objects }] }, final);
  assert.equal(same.frames.length, 1);
  assert.equal(sanitizeTimelapse(null, final), null);
  assert.equal(sanitizeTimelapse({ frames: 'x' }, final), null);
  assert.equal(sanitizeTimelapse({ frames: [] }, final), null);
  assert.equal(sanitizeTimelapse({ frames: [{ set: 'x' }] }, final), null);
  assert.equal(sanitizeTimelapse({ frames: Array.from({ length: 241 }, () => ({})) }, final), null);
});

test('프레임 적용: 같은 id 는 제자리에 바뀌고 지우기는 빠진다', () => {
  const st = emptyScene();
  applyFrame(st, { set: [obj(1), obj(2)] });
  applyFrame(st, { set: [obj(1, 5)], del: [2] });
  assert.deepEqual(st.objects.map(o => [o.id, o.p[0]]), [[1, 5]]);
});
