import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeSettings, applySettings, DEFAULT_SETTINGS, PRESETS, presetFor, canStart, roundCount, stepType, assignee, albumFor, timeFor, minPlayersFor, selfBuildFor, stepAssignee,
  isExactMatch, normalizeAnswer, LIMITS, TIME_PRESETS,
} from '../shared/rules.js';

test('설정 정리: 이상한 값은 기본값으로, 범위는 잘라낸다', () => {
  const s = sanitizeSettings({ mode: 'weird', write: 'nope', build: 99999, guess: 1, turns: 99, maxPlayers: 100 });
  assert.equal(s.mode, 'chain');
  assert.equal(s.write, DEFAULT_SETTINGS.write);
  assert.equal(s.build, LIMITS.timeMax);
  assert.equal(s.guess, LIMITS.timeMin);
  assert.equal(s.time, 'custom');
  assert.equal(s.turns, LIMITS.maxPlayers);
  assert.equal(s.maxPlayers, LIMITS.maxPlayers);
  assert.equal(sanitizeSettings({ turns: 'all' }).turns, 'all');
  assert.equal(sanitizeSettings({ turns: 1 }).turns, 2);
  assert.equal(sanitizeSettings({}).time, 'normal', '기본 시간은 보통');
});

test('시간: 빠른 선택 이름을 보내면 숫자가 채워지고, 숫자를 보내면 커스텀이 된다', () => {
  let s = applySettings(DEFAULT_SETTINGS, { time: 'fast' });
  assert.equal(s.write, TIME_PRESETS.fast.write); assert.equal(s.build, 60); assert.equal(s.time, 'fast');
  s = applySettings(s, { build: 77 });
  assert.equal(s.build, 77); assert.equal(s.time, 'custom'); assert.equal(s.write, 25, '다른 값은 그대로');
  s = applySettings(s, { build: 60 });
  assert.equal(s.time, 'fast', '숫자가 다시 맞아떨어지면 이름표가 돌아온다');
  s = applySettings(s, { time: 'dynamic' });
  assert.equal(s.dynamic, true); assert.equal(s.build, 420);
  s = applySettings(s, { dynamic: false });
  assert.equal(s.time, 'custom');
  s = applySettings(s, { time: 'nope', write: 30 });
  assert.equal(s.write, 30, '모르는 이름표는 무시, 숫자는 적용');
});

test('사전 설정 카드는 설정과 서로 맞아떨어진다', () => {
  for (const p of PRESETS) assert.equal(presetFor(applySettings(DEFAULT_SETTINGS, p.settings)), p.key, p.key);
  assert.equal(presetFor({ ...DEFAULT_SETTINGS, turns: 5 }), null);
});

test('시작 조건: 릴레이 3명부터, 다같이 맞추기 2명부터, 최대 인원 넘으면 안 됨', () => {
  assert.equal(canStart(DEFAULT_SETTINGS, 2).ok, false);
  assert.equal(canStart(DEFAULT_SETTINGS, 3).ok, true);
  assert.equal(canStart({ ...DEFAULT_SETTINGS, mode: 'guess' }, 2).ok, true);
  assert.equal(canStart({ ...DEFAULT_SETTINGS, mode: 'guess' }, 1).ok, false);
  assert.equal(canStart({ ...DEFAULT_SETTINGS, maxPlayers: 3 }, 4).ok, false);
  assert.equal(minPlayersFor({ mode: 'guess' }), 2); assert.equal(minPlayersFor({ mode: 'chain' }), 3);
  assert.equal(PRESETS.length, 2, '사전 설정은 일반·다같이 맞추기 둘뿐');
});

test('다같이 맞추기 만드는 사람: 켜면 제시어 낸 사람, 끄면 다음 사람, 2명이면 항상 직접', () => {
  const seats = ['a', 'b', 'c'];
  const off = { mode: 'guess', selfBuild: false }, on = { mode: 'guess', selfBuild: true };
  assert.equal(selfBuildFor(off, 3), false); assert.equal(selfBuildFor(on, 3), true); assert.equal(selfBuildFor(off, 2), true);
  assert.equal(selfBuildFor({ mode: 'chain', selfBuild: true }, 2), true, '릴레이도 설정대로'); assert.equal(selfBuildFor({ mode: 'chain', selfBuild: false }, 2), false);
  assert.equal(stepAssignee(off, seats, 0, 0), 'a'); assert.equal(stepAssignee(off, seats, 0, 1), 'b');
  assert.equal(stepAssignee(on, seats, 0, 1), 'a'); assert.equal(stepAssignee(on, seats, 2, 1), 'c');
  assert.equal(stepAssignee(off, ['a', 'b'], 1, 1), 'b', '둘이면 설정과 무관하게 직접');
  assert.equal(sanitizeSettings({ selfBuild: 1 }).selfBuild, true); assert.equal(sanitizeSettings({}).selfBuild, false);
});

test('릴레이 직접 만들기: 라운드가 턴의 두 배, 글·3D 한 쌍을 같은 사람이 맡고 매 라운드 한 사람당 앨범 하나', () => {
  const seats = ['a', 'b', 'c'], on = { mode: 'chain', turns: 'all', selfBuild: true };
  assert.equal(roundCount(on, 3), 6); assert.equal(roundCount({ ...on, turns: 2 }, 5), 4); assert.equal(roundCount({ ...on, selfBuild: false }, 3), 3);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(r => stepAssignee(on, seats, 0, r)), ['a', 'a', 'b', 'b', 'c', 'c']);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(r => stepAssignee(on, seats, 1, r)), ['b', 'b', 'c', 'c', 'a', 'a']);
  for (let r = 0; r < 6; r++) assert.deepEqual([0, 1, 2].map(a => stepAssignee(on, seats, a, r)).sort(), seats, `라운드 ${r}: 모두 앨범 하나씩`);
  assert.deepEqual([0, 1, 2].map(r => stepAssignee({ ...on, selfBuild: false }, seats, 0, r)), ['a', 'b', 'c'], '끄면 예전처럼');
});

test('라운드 수: 릴레이는 인원(또는 턴 수), 다같이 맞추기는 2', () => {
  assert.equal(roundCount({ mode: 'chain', turns: 'all' }, 5), 5);
  assert.equal(roundCount({ mode: 'chain', turns: 3 }, 5), 3);
  assert.equal(roundCount({ mode: 'chain', turns: 8 }, 5), 5);
  assert.equal(roundCount({ mode: 'guess' }, 5), 2);
});

test('글/3D 번갈아: 짝수 라운드는 글, 홀수 라운드는 3D', () => {
  assert.deepEqual([0, 1, 2, 3].map(stepType), ['write', 'build', 'write', 'build']);
});

test('앨범 돌리기: 매 라운드 모두가 서로 다른 앨범을 하나씩 맡고, 자기 앨범은 처음에만', () => {
  const seats = ['a', 'b', 'c', 'd', 'e'];
  for (let r = 0; r < seats.length; r++) {
    const who = seats.map((_, album) => assignee(seats, album, r));
    assert.deepEqual([...who].sort(), [...seats].sort(), `round ${r} 전원 배정`);
    for (const id of seats) assert.equal(assignee(seats, albumFor(seats, id, r), r), id, 'albumFor ↔ assignee');
    if (r > 0) seats.forEach((id, album) => assert.notEqual(assignee(seats, album, r), id, '자기 앨범은 다시 안 받음'));
  }
  assert.equal(albumFor(seats, 'zzz', 0), -1);
});

test('제한시간은 프리셋을 따른다', () => {
  assert.equal(timeFor({ build: 77 }, 'build'), 77);
  assert.equal(timeFor({}, 'write'), 45);
  assert.equal(timeFor(applySettings(DEFAULT_SETTINGS, { time: 'fast' }), 'guess'), 25);
});

test('정답 비교: 띄어쓰기·문장부호·대소문자 무시', () => {
  assert.equal(normalizeAnswer(' 머리에 뿔 달린 소! '), '머리에뿔달린소');
  assert.ok(isExactMatch('머리에뿔달린 소', '머리에 뿔 달린 소'));
  assert.ok(isExactMatch('Space CAT', 'space cat'));
  assert.ok(!isExactMatch('', ''));
  assert.ok(!isExactMatch('소', '머리에 뿔 달린 소'));
});
