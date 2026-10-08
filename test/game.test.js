// 서버 상태 머신을 네트워크 없이 돌려 본다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Lobby } from '../server/game.js';

function harness() {
  const inbox = new Map(); // id → msgs[]
  const lobby = new Lobby('TEST', { send: (id, m) => { (inbox.get(id) || inbox.set(id, []).get(id)).push(m); }, onEmpty: () => {} });
  const last = (id, type) => [...(inbox.get(id) || [])].reverse().find(m => m.type === type);
  const all = (id, type) => (inbox.get(id) || []).filter(m => m.type === type);
  return { lobby, inbox, last, all };
}
const P = ['a', 'b', 'c'];
function joinAll(h, names = ['하나', '두리', '세찌']) { P.forEach((id, i) => h.lobby.join(id, names[i], { shape: i, color: i })); }
const scene = () => ({ v: 1, bg: 0, objects: [{ id: 1, kind: 'box', p: [0, 0.5, 0], q: [0, 0, 0, 1], s: [1, 1, 1], mat: { c: '#ffffff', f: 'basic' } }] });

test('입장: 방장은 첫 사람, 같은 이름은 숫자를 붙인다, 가득 차면 거절', () => {
  const h = harness();
  h.lobby.handle('x', { type: 'settings' }); // 아직 없는 사람 → 무시
  joinAll(h, ['하나', '하나', '세찌']);
  assert.equal(h.lobby.hostId, 'a');
  assert.notEqual(h.lobby.name('b'), '하나');
  assert.match(h.lobby.name('b'), /^하나\d\d$/);
  h.lobby.handle('a', { type: 'settings', settings: { maxPlayers: 3 } });
  assert.equal(h.lobby.join('d', '넷', {}).ok, false);
  const lob = h.last('c', 'lobby');
  assert.equal(lob.players.length, 3);
  assert.equal(lob.canStart.ok, true);
});

test('방장만 설정을 바꿀 수 있고, 프리셋은 묶음으로 적용된다', () => {
  const h = harness(); joinAll(h);
  h.lobby.handle('b', { type: 'settings', settings: { time: 'fast' } });
  assert.equal(h.lobby.settings.time, 'normal');
  h.lobby.handle('a', { type: 'preset', key: 'speed' });
  assert.equal(h.lobby.settings.time, 'fast'); assert.equal(h.lobby.settings.build, 60);
  h.lobby.handle('a', { type: 'settings', settings: { build: 95 } });
  assert.equal(h.lobby.settings.build, 95); assert.equal(h.lobby.settings.time, 'custom', '초 단위 직접 설정');
  h.lobby.handle('a', { type: 'settings', settings: 'garbage' });
  assert.equal(h.lobby.settings.build, 95);
  h.lobby.handle('a', { type: 'preset', key: 'guess' });
  assert.equal(h.lobby.settings.mode, 'guess'); assert.equal(h.lobby.settings.build, 120);
});

test('릴레이 한 판: 글 → 3D → 글, 앨범 공개, 로비로', () => {
  const h = harness(); joinAll(h);
  h.lobby.handle('b', { type: 'start' });
  assert.equal(h.lobby.game, null, '방장이 아니면 시작 못 함');
  h.lobby.handle('a', { type: 'start' });
  const g = h.lobby.game;
  assert.equal(g.rounds, 3);
  for (const id of P) {
    const ph = h.last(id, 'phase');
    assert.equal(ph.phase, 'step'); assert.equal(ph.task.type, 'write'); assert.equal(ph.task.suggestions.length, 4);
    h.lobby.handle(id, { type: 'submit', text: `제시어 ${id}` });
  }
  assert.equal(g.round, 1, '모두 내면 바로 다음 라운드');
  for (const id of P) {
    const ph = h.last(id, 'phase');
    assert.equal(ph.task.type, 'build');
    assert.match(ph.task.prev.text, /^제시어 /);
    assert.notEqual(ph.task.prev.by, id, '자기 글을 자기가 만들지 않는다');
  }
  // 수정하기(unsubmit) 뒤 다시 제출
  h.lobby.handle('a', { type: 'submit', scene: scene() });
  assert.deepEqual(h.last('b', 'progress').done, ['a']);
  h.lobby.handle('a', { type: 'unsubmit' });
  assert.deepEqual(h.last('b', 'progress').done, []);
  for (const id of P) h.lobby.handle(id, { type: 'submit', scene: { ...scene(), objects: [...scene().objects, { id: 2, kind: 'prop', prop: 'tank' }] } });
  assert.equal(g.round, 2);
  for (const id of P) {
    const ph = h.last(id, 'phase');
    assert.equal(ph.task.type, 'write');
    assert.equal(ph.task.prev.scene.objects.length, 1, '모르는 종류(옛 소품)는 걸러진다');
    h.lobby.handle(id, { type: 'submit', text: `추측 ${id}` });
  }
  assert.equal(g.phase, 'album');
  const alb = h.last('c', 'phase');
  assert.equal(alb.task.albums.length, 3);
  assert.deepEqual(alb.task.albums[0].steps.map(s => s.type), ['write', 'build', 'write']);
  h.lobby.handle('b', { type: 'albumNext' });
  assert.equal(h.lobby.game.album.step, 0, '방장만 넘길 수 있다');
  h.lobby.handle('a', { type: 'albumNext' }); h.lobby.handle('a', { type: 'albumNext' }); h.lobby.handle('a', { type: 'albumNext' });
  assert.deepEqual(h.lobby.game.album, { index: 1, step: 0 });
  h.lobby.handle('a', { type: 'albumPrev' });
  assert.deepEqual(h.lobby.game.album, { index: 0, step: 2 });
  h.lobby.handle('a', { type: 'toLobby' });
  assert.equal(h.lobby.game, null);
  assert.equal(h.last('b', 'phase').phase, 'lobby');
});

test('빈 제출·시간 초과는 서버가 채워 넣는다', () => {
  const h = harness(); joinAll(h);
  h.lobby.handle('a', { type: 'start' });
  for (const id of P) h.lobby.handle(id, { type: 'submit', text: '   ' });
  for (const id of P) assert.ok(h.last(id, 'phase').task.prev.text.length > 0, '랜덤 제시어가 들어감');
  for (const id of P) h.lobby.handle(id, { type: 'submit', scene: null });
  for (const id of P) assert.deepEqual(h.last(id, 'phase').task.prev.scene.objects, []);
  h.lobby.endGame();
});

test('다같이 맞추기: 정확히 쓰면 자동 정답, 첫 정답 3점·제작자 2점·출제자 1점, 판정·건너뛰기', () => {
  const h = harness(); joinAll(h);
  h.lobby.handle('a', { type: 'preset', key: 'guess' });
  h.lobby.handle('a', { type: 'start' });
  const g = h.lobby.game;
  assert.equal(g.rounds, 2);
  for (const id of P) h.lobby.handle(id, { type: 'submit', text: `정답 ${id}` });
  for (const id of P) h.lobby.handle(id, { type: 'submit', scene: scene() });
  assert.equal(g.phase, 'guess');
  const r0 = h.last('a', 'phase').task.round;
  assert.equal(r0.idx, 0);
  const author = r0.author, builder = r0.builder, guesser = P.find(x => x !== author && x !== builder);
  assert.equal(h.last(author, 'phase').task.round.answer, `정답 ${author}`, '출제자는 답을 본다');
  assert.equal(h.last(guesser, 'phase').task.round.answer, null, '맞추는 사람은 못 본다');
  h.lobby.handle(guesser, { type: 'chat', text: '엉뚱한 답' });
  assert.equal(h.last(guesser, 'guessMade').guess.text, '엉뚱한 답');
  assert.equal(h.last(builder, 'guessMade').guess.text, '엉뚱한 답', '제작자는 추측 내용을 본다');
  assert.equal(h.last(author, 'guessMade').guess.text, '엉뚱한 답');
  h.lobby.handle(builder, { type: 'chat', text: '힌트!' });
  assert.equal(h.last(guesser, 'chat').text, '힌트!', '맞추는 사람이 아니면 그냥 채팅');
  h.lobby.handle(guesser, { type: 'chat', text: ` 정답${author} ` });
  const made = h.last(guesser, 'guessMade');
  assert.equal(made.guess.correct, true);
  assert.equal(g.guess.done, true, '맞출 사람이 다 맞추면 라운드 끝');
  const res = h.last('a', 'guessResult');
  assert.deepEqual(res.solved, [guesser]);
  const score = id => h.lobby.players.get(id).score;
  assert.equal(score(guesser), 3); assert.equal(score(builder), 2); assert.equal(score(author), 1);
  // 2번째 작품: 출제자가 ✓ 로 인정
  h.lobby.nextGuessRound();
  const r1 = h.last('a', 'guessRound').round;
  const g1 = P.find(x => x !== r1.author && x !== r1.builder);
  h.lobby.handle(g1, { type: 'chat', text: '비슷한 답' });
  const gid = h.last(r1.author, 'guessMade').guess.id;
  h.lobby.handle(r1.builder, { type: 'judge', guessId: gid });
  assert.equal(g.guess.solved.size, 0, '출제자만 판정');
  h.lobby.handle(r1.author, { type: 'judge', guessId: gid });
  assert.equal(g.guess.solved.has(g1), true);
  // 3번째: 건너뛰기 → 점수
  h.lobby.nextGuessRound();
  h.lobby.handle(h.lobby.hostId, { type: 'skipRound' });
  assert.equal(g.guess.done, true);
  h.lobby.nextGuessRound();
  assert.equal(g.phase, 'score');
  h.lobby.handle('a', { type: 'toLobby' });
  assert.equal(h.lobby.game, null);
});

test('게임 중 나간 사람은 자리를 지키고, 같은 이름으로 돌아오면 이어서 한다', () => {
  const h = harness(); joinAll(h);
  h.lobby.handle('a', { type: 'start' });
  h.lobby.leave('b');
  assert.equal(h.lobby.players.get('b').connected, false);
  h.lobby.handle('a', { type: 'submit', text: 'x' }); h.lobby.handle('c', { type: 'submit', text: 'y' });
  assert.equal(h.lobby.game.round, 1, '접속이 끊긴 사람은 기다리지 않는다');
  const r = h.lobby.join('b2', '두리', {});
  assert.equal(r.ok, true);
  assert.ok(h.lobby.game.seats.includes('b2'));
  const ph = h.last('b2', 'phase');
  assert.equal(ph.phase, 'step'); assert.equal(ph.task.type, 'build');
  assert.equal(h.lobby.join('z', '새사람', {}).ok, false, '진행 중엔 새 사람은 못 들어옴');
  h.lobby.endGame();
});

test('대기실에서 나가기: 바로 빠지고 방장이 넘어가며, 게임 중에는 자리만 비운다', () => {
  const h = harness(); joinAll(h);
  h.lobby.leave('b', true);
  assert.equal(h.last('b', 'left')?.lobby, 'TEST', '나간 사람에게 left 알림');
  assert.deepEqual(h.lobby.order, ['a', 'c']);
  h.lobby.leave('a', true);
  assert.equal(h.lobby.hostId, 'c', '방장이 나가면 다음 사람이 방장');
  assert.equal(h.last('c', 'lobby').players.length, 1);
  // 게임 중 나가기 = 접속 끊김과 같다(같은 이름으로 돌아올 수 있게 자리는 남긴다)
  h.lobby.join('d', '넷', {}); h.lobby.join('e', '다섯', {});
  h.lobby.handle('c', { type: 'start' });
  h.lobby.leave('d', true);
  assert.equal(h.lobby.players.get('d').connected, false);
  assert.equal(h.lobby.order.length, 3);
  h.lobby.handle('c', { type: 'abort' }); // 타이머 정리
});

test('따봉: 3D 작품에만, 내 작품은 안 되고, 다시 누르면 취소, 만든 사람 누적', () => {
  const h = harness(); joinAll(h);
  h.lobby.handle('a', { type: 'start' });
  for (const id of P) h.lobby.handle(id, { type: 'submit', text: `제시어 ${id}` });
  for (const id of P) h.lobby.handle(id, { type: 'submit', scene: scene() });
  for (const id of P) h.lobby.handle(id, { type: 'submit', text: `추측 ${id}` });
  const g = h.lobby.game;
  assert.equal(g.phase, 'album');
  const builder = g.albums[0].steps[1].by;
  const other = P.find(x => x !== builder);
  h.lobby.handle(builder, { type: 'like', album: 0, step: 1 });
  assert.deepEqual(g.albums[0].steps[1].likes, [], '내 작품에는 못 누른다');
  h.lobby.handle(other, { type: 'like', album: 0, step: 0 });
  assert.deepEqual(g.albums[0].steps[0].likes, [], '글에는 못 누른다');
  h.lobby.handle(other, { type: 'like', album: 0, step: 1 });
  assert.deepEqual(g.albums[0].steps[1].likes, [other]);
  const m = h.last(builder, 'likes');
  assert.equal(m.album, 0); assert.equal(m.step, 1); assert.deepEqual(m.likes, [other]);
  assert.equal(m.players.find(p => p.id === builder).likes, 1, '만든 사람의 받은 따봉 수');
  h.lobby.handle(other, { type: 'like', album: 0, step: 1 });
  assert.deepEqual(g.albums[0].steps[1].likes, [], '다시 누르면 취소');
  assert.equal(h.lobby.players.get(builder).likes, 0);
  assert.ok(h.last(other, 'phase').task.albums[0].steps[1].likes, '앨범 데이터에 likes 가 실려 간다');
});
