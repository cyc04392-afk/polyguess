import { t } from '../shared/i18n.js';
// 조작 방식(단축키·마우스) 모드: 기본 / 블렌더 / 마야 / 3ds Max / ZBrush.
// 카메라 제스처는 { button(0 왼쪽·1 휠·2 오른쪽), mods:['ctrl'|'shift'|'alt'], emptyOnly } 로 적는다.
// 키는 'Ctrl+Shift+KeyZ' 꼴의 문자열(e.code 기준). Ctrl 은 맥의 Cmd 도 포함한다.

const G = (button, mods = [], extra = {}) => ({ button, mods, ...extra });

export const SCHEMES = {
  basic: {
    key: 'basic', name: t('기본'), short: t('기본'),
    camera: { orbit: G(0, [], { emptyOnly: true }), pan: G(2), pan2: G(1), zoomDrag: null },
    box: G(0, ['shift']),
    keys: {
      select: 'KeyV', move: 'KeyW', rotate: 'KeyE', scale: 'KeyR', sculpt: 'KeyT',
      duplicate: 'Ctrl+KeyD', remove: ['Delete', 'Backspace'], frame: 'KeyF', selectAll: 'Ctrl+KeyA', deselect: 'Escape',
      undo: 'Ctrl+KeyZ', redo: ['Ctrl+KeyY', 'Ctrl+Shift+KeyZ'], edit: 'Tab', bevel: 'Ctrl+KeyB', loopcut: 'Ctrl+KeyR', extrude: 'Ctrl+KeyE', inset: 'Ctrl+KeyI', paint: 'KeyP',
      views: { Numpad1: 'front', Numpad3: 'side', Numpad7: 'top' },
    },
    mouseHelp: [[t('시점 돌리기'), t('빈 곳을 왼쪽 드래그')], [t('시점 옮기기'), t('오른쪽 드래그 (또는 휠 드래그)')], [t('확대/축소'), t('휠')], [t('여러 개 고르기'), t('Shift+왼쪽 드래그로 네모 치기')]],
  },
  blender: {
    key: 'blender', name: t('블렌더 (Blender)'), short: 'Blender',
    camera: { orbit: G(1), pan: G(1, ['shift']), zoomDrag: G(1, ['ctrl']) },
    box: G(0, [], { emptyOnly: true }),
    keys: {
      select: null, move: 'KeyG', rotate: 'KeyR', scale: 'KeyS', sculpt: 'KeyT',
      duplicate: 'Shift+KeyD', remove: ['KeyX', 'Delete'], frame: 'NumpadDecimal', selectAll: 'KeyA', deselect: ['Alt+KeyA', 'Escape'],
      undo: 'Ctrl+KeyZ', redo: 'Ctrl+Shift+KeyZ', edit: 'Tab', bevel: 'Ctrl+KeyB', loopcut: 'Ctrl+KeyR', extrude: 'Ctrl+KeyE', inset: 'Ctrl+KeyI', paint: 'KeyP',
      views: { Numpad1: 'front', Numpad3: 'side', Numpad7: 'top' },
    },
    mouseHelp: [[t('시점 돌리기'), t('휠 버튼 드래그')], [t('시점 옮기기'), t('Shift+휠 드래그')], [t('확대/축소'), t('휠 (또는 Ctrl+휠 드래그)')], [t('여러 개 고르기'), t('빈 곳에서 왼쪽 드래그로 네모 치기')]],
  },
  maya: {
    key: 'maya', name: t('마야 (Maya)'), short: 'Maya',
    camera: { orbit: G(0, ['alt']), pan: G(1, ['alt']), zoomDrag: G(2, ['alt']) },
    box: G(0, [], { emptyOnly: true }),
    keys: {
      select: 'KeyQ', move: 'KeyW', rotate: 'KeyE', scale: 'KeyR', sculpt: 'KeyT',
      duplicate: 'Ctrl+KeyD', remove: ['Delete', 'Backspace'], frame: 'KeyF', selectAll: 'Ctrl+KeyA', deselect: 'Escape',
      undo: 'Ctrl+KeyZ', redo: ['Shift+KeyZ', 'Ctrl+KeyY'], edit: 'Tab', bevel: 'Ctrl+KeyB', loopcut: 'Ctrl+KeyR', extrude: 'Ctrl+KeyE', inset: 'Ctrl+KeyI', paint: 'KeyP',
      views: { Numpad1: 'front', Numpad3: 'side', Numpad7: 'top' },
    },
    mouseHelp: [[t('시점 돌리기'), t('Alt+왼쪽 드래그')], [t('시점 옮기기'), t('Alt+휠 드래그')], [t('확대/축소'), t('Alt+오른쪽 드래그 또는 휠')], [t('여러 개 고르기'), t('빈 곳에서 왼쪽 드래그로 네모 치기')]],
  },
  max: {
    key: 'max', name: '3ds Max', short: '3ds Max',
    camera: { orbit: G(1, ['alt']), pan: G(1), zoomDrag: G(1, ['ctrl', 'alt']) },
    box: G(0, [], { emptyOnly: true }),
    keys: {
      select: 'KeyQ', move: 'KeyW', rotate: 'KeyE', scale: 'KeyR', sculpt: 'KeyT',
      duplicate: ['Ctrl+KeyV', 'Ctrl+KeyD'], remove: ['Delete', 'Backspace'], frame: 'KeyZ', selectAll: 'Ctrl+KeyA', deselect: 'Escape',
      undo: 'Ctrl+KeyZ', redo: 'Ctrl+KeyY', edit: 'Tab', bevel: 'Ctrl+KeyB', loopcut: 'Ctrl+KeyR', extrude: 'Ctrl+KeyE', inset: 'Ctrl+KeyI', paint: 'KeyP',
      views: { Numpad1: 'front', Numpad3: 'side', Numpad7: 'top' },
    },
    mouseHelp: [[t('시점 돌리기'), t('Alt+휠 드래그')], [t('시점 옮기기'), t('휠 드래그')], [t('확대/축소'), t('휠 (또는 Ctrl+Alt+휠 드래그)')], [t('여러 개 고르기'), t('빈 곳에서 왼쪽 드래그로 네모 치기')]],
  },
  zbrush: {
    key: 'zbrush', name: t('지브러시 (ZBrush)'), short: 'ZBrush',
    camera: { orbit: G(2), orbit2: G(0, [], { emptyOnly: true }), pan: G(2, ['alt']), zoomDrag: G(2, ['ctrl']) },
    box: G(0, ['shift']),
    keys: {
      select: 'KeyV', move: 'KeyW', scale: 'KeyE', rotate: 'KeyR', sculpt: 'KeyQ',
      duplicate: 'Ctrl+KeyD', remove: ['Delete', 'Backspace'], frame: 'KeyF', selectAll: 'Ctrl+KeyA', deselect: 'Escape',
      undo: 'Ctrl+KeyZ', redo: 'Ctrl+Shift+KeyZ', edit: 'Tab', bevel: 'Ctrl+KeyB', loopcut: 'Ctrl+KeyR', extrude: 'Ctrl+KeyE', inset: 'Ctrl+KeyI', paint: 'KeyP',
      views: { Numpad1: 'front', Numpad3: 'side', Numpad7: 'top' },
    },
    mouseHelp: [[t('시점 돌리기'), t('오른쪽 드래그 (빈 곳 왼쪽 드래그도 됨)')], [t('시점 옮기기'), t('Alt+오른쪽 드래그')], [t('확대/축소'), t('휠 (또는 Ctrl+오른쪽 드래그)')], [t('여러 개 고르기'), t('Shift+왼쪽 드래그로 네모 치기')]],
  },
};
export const SCHEME_KEYS = Object.keys(SCHEMES);

// 모든 모드에서 같은 키: 점·선·면 1·2·3, 복사/붙여넣기, 도움말. 밀어내기·인셋은 실수로 눌리지 않게 모든 모드에서 Ctrl+E·Ctrl+I
export const COMMON_KEYS = { vert: 'Digit1', edge: 'Digit2', face: 'Digit3', copy: 'Ctrl+KeyC', paste: 'Ctrl+KeyV', help: 'F1' };

const STORE_KEY = 'polyguess.scheme';
export function loadSchemeKey() { try { const k = localStorage.getItem(STORE_KEY); return SCHEMES[k] ? k : 'basic'; } catch { return 'basic'; } }
export function saveSchemeKey(k) { try { localStorage.setItem(STORE_KEY, k); } catch { /* 저장 못 해도 계속 */ } }

// 'Ctrl+Shift+KeyZ' 가 이 키 이벤트와 맞는지 (수식키는 정확히 일치해야 한다)
export function matchKey(binding, e) {
  if (!binding) return false;
  if (Array.isArray(binding)) return binding.some(b => matchKey(b, e));
  const parts = binding.split('+');
  const code = parts.pop();
  const want = { ctrl: parts.includes('Ctrl'), shift: parts.includes('Shift'), alt: parts.includes('Alt') };
  return e.code === code && (e.ctrlKey || e.metaKey) === want.ctrl && e.shiftKey === want.shift && e.altKey === want.alt;
}
// 포인터 이벤트가 제스처 정의와 맞는지
export function matchGesture(g, e) {
  if (!g || e.button !== g.button) return false;
  const has = { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey, alt: e.altKey };
  for (const m of ['ctrl', 'shift', 'alt']) if (has[m] !== g.mods.includes(m)) return false;
  return true;
}
// 도움말에 보여 줄 키 이름
export function keyLabel(binding) {
  if (!binding) return '—';
  if (Array.isArray(binding)) return binding.map(keyLabel).join(' ' + t('또는') + ' ');
  return binding.split('+').map(p => p.replace(/^Key/, '').replace(/^Digit/, '').replace('NumpadDecimal', t('숫자패드') + ' .').replace(/^Numpad/, t('숫자패드') + ' ').replace('Delete', 'Del').replace('Escape', 'Esc')).join('+');
}
