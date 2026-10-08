// 번역 틀(shared/i18n.js)과 언어 사전(shared/lang/*.js)이 빈틈없는지 확인한다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LANGS, LANG_CODES, DICTS, DEFAULT_LANG, normalizeLang, pickLang, detectLang, format, t, hasKey, setLang, getLang,
} from '../shared/i18n.js';
import { collectKeys } from '../scripts/i18n-keys.js';
import { Lobby } from '../server/game.js';
import { promptSuggestions, MSG } from '../shared/rules.js';

const HANGUL = /[ㄱ-ㆎ가-힣]/;
const placeholders = s => new Set([...String(s).matchAll(/\{(\w+)/g)].map(m => m[1]));

test('언어 코드 정리: 지역 꼬리표는 떼고, 모르는 언어는 null', () => {
  assert.equal(normalizeLang('en-US'), 'en');
  assert.equal(normalizeLang('zh-TW'), 'zh');
  assert.equal(normalizeLang('ZH_cn'), 'zh');
  assert.equal(normalizeLang('ja'), 'ja');
  assert.equal(normalizeLang('pt-BR'), null);
  assert.equal(normalizeLang(''), null);
  assert.equal(normalizeLang(null), null);
  assert.deepEqual(LANG_CODES, LANGS.map(l => l.code));
  assert.equal(LANGS[0].code, DEFAULT_LANG, '첫 언어는 기본 언어(한국어)');
  assert.deepEqual(Object.keys(DICTS).sort(), LANG_CODES.filter(c => c !== DEFAULT_LANG).sort(), '기본 언어 빼고 전부 사전이 있어야 함');
});

test('언어 고르기: ?lang → 저장값 → 브라우저 언어 → 한국어 순서', () => {
  assert.equal(pickLang(['xx', 'fr-CA', 'en']), 'fr');
  assert.equal(pickLang([]), DEFAULT_LANG);
  assert.equal(detectLang({ search: '?c=ABCD&lang=de', stored: 'en', navigatorLangs: ['ja'] }), 'de');
  assert.equal(detectLang({ search: '?lang=nope', stored: 'en', navigatorLangs: ['ja'] }), 'en');
  assert.equal(detectLang({ search: '', stored: null, navigatorLangs: ['zh-Hans-CN', 'en'] }), 'zh');
  assert.equal(detectLang({}), DEFAULT_LANG);
});

test('자리표 채우기: {n} 과 {n|하나|여럿}', () => {
  assert.equal(format('{n} {n|player|players}', { n: 1 }), '1 player');
  assert.equal(format('{n} {n|player|players}', { n: 3 }), '3 players');
  assert.equal(format('방 {code}', { code: 'AB12' }), '방 AB12');
  assert.equal(format('{a} {b}', { a: 'x' }), 'x {b}', '없는 값은 그대로 둔다');
  assert.equal(format('그대로', null), '그대로');
});

test('t(): 사전에 있으면 번역, 없으면 한국어 원문 그대로', () => {
  assert.equal(t('닫기', null, 'en'), 'Close');
  assert.equal(t('닫기', null, 'ko'), '닫기');
  assert.equal(t('이런 키는 없음', null, 'en'), '이런 키는 없음');
  assert.equal(t('방 {code}', { code: 'Q1' }, 'fr'), 'Salon Q1');
  assert.equal(hasKey('닫기', 'de'), true);
  assert.equal(hasKey('닫기', 'ko'), false);
  const before = getLang();
  assert.equal(setLang('en-GB'), 'en');
  assert.equal(t('닫기'), 'Close', '현재 언어가 기본으로 쓰인다');
  assert.equal(setLang('??'), DEFAULT_LANG);
  setLang(before);
});

test('사전 빈틈 검사: 코드의 모든 한국어 글자가 다섯 언어 전부에 있고, 자리표가 같고, 틀 밖의 한글이 없다', () => {
  const { keys, leftovers } = collectKeys();
  assert.ok(keys.size > 400, `키가 너무 적음: ${keys.size}`);
  assert.deepEqual(leftovers, [], '번역 틀(t()/data-i18n) 밖에 남은 한글');
  for (const [code, dict] of Object.entries(DICTS)) {
    const missing = [...keys.keys()].filter(k => !Object.prototype.hasOwnProperty.call(dict, k));
    assert.deepEqual(missing, [], `${code}: 빠진 키`);
    const extra = Object.keys(dict).filter(k => !keys.has(k));
    assert.deepEqual(extra, [], `${code}: 코드에 없는 키`);
    for (const [k, v] of Object.entries(dict)) {
      assert.equal(typeof v, 'string', `${code}: ${k} 값이 문자열이 아님`);
      assert.ok(v.length > 0, `${code}: ${k} 가 비어 있음`);
      assert.deepEqual(placeholders(v), placeholders(k), `${code}: 자리표가 다름 — ${k}`);
      if (code !== 'ja' && code !== 'zh') assert.ok(!HANGUL.test(v), `${code}: 번역에 한글이 남음 — ${k}`);
      else assert.ok(!HANGUL.test(v), `${code}: 번역에 한글이 남음 — ${k}`);
      for (const tag of ['<b>', '<em>', '<small>', '<kbd>', '<a ', '<span>']) {
        const n = s => s.split(tag).length - 1;
        assert.equal(n(v), n(k), `${code}: ${tag} 개수가 다름 — ${k}`);
      }
    }
  }
});

test('방 언어: 방장의 언어를 따라 제시어 추천·거절 메시지가 번역된다', () => {
  const inbox = new Map();
  const lobby = new Lobby('TEST', { send: (id, m) => { (inbox.get(id) || inbox.set(id, []).get(id)).push(m); }, onEmpty: () => {} });
  const last = (id, type) => [...(inbox.get(id) || [])].reverse().find(m => m.type === type);
  try {
  lobby.join('a', '', {}, 'en-US');
  assert.equal(lobby.lang, 'en', '방장 언어 = 방 언어');
  assert.equal(last('a', 'welcome').name, 'Player1', '빈 이름은 그 사람 언어로 채운다');
  lobby.join('b', '두리', {}, 'de');
  assert.equal(lobby.lang, 'en', '방장이 아니면 방 언어는 안 바뀐다');
  lobby.handle('a', { type: 'start' });
  const err = last('a', 'error');
  assert.ok(err && err.key && err.params, '시작 실패는 key+params 로 온다');
  assert.equal(err.text, t(err.key, err.params, 'en'));
  assert.ok(!HANGUL.test(err.text), err.text);
  lobby.join('c', '세찌', {}, 'ja');
  lobby.handle('a', { type: 'start' });
  const ph = last('a', 'phase');
  const task = ph && ph.task;
  assert.ok(task && task.suggestions && task.suggestions.length === 4, '첫 라운드 제시어 추천 4개');
  const en = new Set(promptSuggestions('en'));
  for (const s of task.suggestions) assert.ok(en.has(s), `영어 추천이어야 함: ${s}`);
  const r = lobby.join('z', '늦은사람', {}, 'fr');
  assert.equal(r.ok, false);
  assert.equal(r.key, MSG.inGame);
  assert.equal(r.text, t(MSG.inGame, null, 'fr'));
  } finally { lobby.endGame(); } // 타이머를 멈춰야 테스트 프로세스가 끝난다
});
