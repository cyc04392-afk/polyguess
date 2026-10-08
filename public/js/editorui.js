// 3D 만들기 도구의 화면 — 갈틱폰 그리기 화면처럼 글씨 없이: 왼쪽 색, 오른쪽 도구 아이콘, 아래 도형 그림과 완료,
// 노트 머리 왼쪽에 물체/점/선/면(Tab·1·2·3), 오른쪽에 스크린샷·조작 모드.
// index.html / demo.html 의 #step-build 안 요소 id 들을 그대로 전제한다. 게임(main.js)과 체험판(demo.js)이 같이 쓴다.
import { Editor, TOOLS } from './editor.js';
import { PRIMITIVES } from './shapes.js';
import { PALETTE, FINISHES, BG_PRESETS, isLight } from './sceneio.js';
import { BRUSHES } from './sculpt.js';
import { ICONS } from './icons.js';
import { renderThumbs } from './thumbs.js';
import { EDIT_MODES, OP_RANGE } from './editmode.js';
import { LIGHT_TYPES_UI, LIGHT_RANGE } from './lights.js';
import { SCHEMES, SCHEME_KEYS, COMMON_KEYS, keyLabel } from './schemes.js';
import { emptyScene } from '../shared/scene.js';
import { isPainted } from '../shared/paint.js';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'disabled') n.disabled = !!v;
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)));
  return n;
}

const U = { editor: null, thumbs: null, bound: false, locked: false };
const kb = b => `<kbd>${esc(keyLabel(b))}</kbd>`;

// 오른쪽 도구 기둥(아이콘만, 설명은 마우스를 올리면). need: 'sel' 고른 것 필요, 'mesh' 도형 하나(또는 편집 중) 필요
const ACTIONS = [
  ...TOOLS.map(t => ({ key: t.key, tool: true, title: K => `${t.name} (${keyLabel(K[t.key])})` })),
  { key: 'snap', toggle: true, title: () => '격자에 맞추기 (일정한 칸·각도로 움직여요)' },
  { key: 'edit', need: 'mesh', title: K => `점·선·면 편집 켜기/끄기 (${keyLabel(K.edit)})` },
  { key: 'bevel', need: 'mesh', title: K => `베벨: 모서리를 깎아 둥글게 (${keyLabel(K.bevel)})` },
  { key: 'loopcut', need: 'mesh', title: K => `루프 자르기: 한 바퀴 선을 넣어 면을 나눠요 (${keyLabel(K.loopcut)})` },
  { key: 'extrude', need: 'mesh', title: K => `밀어내기: 고른 면을 끌어내요 (${keyLabel(K.extrude)})` },
  { key: 'inset', need: 'mesh', title: K => `인셋: 면의 테두리를 안쪽으로 모아 안쪽 면과 띠로 나눠요 (${keyLabel(K.inset)})` },
  { key: 'duplicate', need: 'sel', title: K => `복제: 제자리에 하나 더 (${keyLabel(K.duplicate)}) · 복사 ${keyLabel(COMMON_KEYS.copy)} / 붙여넣기 ${keyLabel(COMMON_KEYS.paste)}` },
  { key: 'mirror', need: 'sel', title: () => '좌우 뒤집어 복제' },
  { key: 'drop', need: 'sel', title: () => '바닥에 붙이기' },
  { key: 'remove', need: 'sel', danger: true, title: K => `삭제 (${keyLabel(K.remove)})` },
  { key: 'light', title: () => '광원 넣기 (해·전구·스포트). 넣은 뒤 아래 줄에서 종류·세기·방향을 바꿔요' },
  { key: 'bg', title: () => '배경 바꾸기' },
  { key: 'help', title: () => '도움말 (F1)' },
];

export function mountEditor(container) {
  if (U.editor) return U.editor;
  if (!U.thumbs) U.thumbs = renderThumbs();
  U.editor = new Editor(container, {
    onSelection, onMessage: showEditorMsg,
    onTool: () => { paintTools(); renderCtx(); },
    onHistory: () => { if (U.editor?.tool === 'paint') renderCtx(); },
    onEdit: () => { paintTools(); renderModebar(); renderCtx(); },
    onScheme: () => { buildTools(); renderModebar(); renderHelp(); paintTools(); renderCtx(); },
  });
  buildPanels();
  if (!U.bound) {
    U.bound = true;
    $('#help-close').onclick = closeHelp;
    $('#help').addEventListener('click', e => { if (e.target === e.currentTarget) closeHelp(); });
    window.addEventListener('keydown', e => { if (e.key === 'Escape') closeHelp(); if (e.key === 'F1') { e.preventDefault(); openHelp(); } });
    renderHelp();
  }
  return U.editor;
}
export function getEditor() { return U.editor; }
// 새 작품 시작(이전 작품이 있으면 이어서)
export function resetEditor(scene) {
  const E = U.editor; if (!E) return;
  E.load(scene || emptyScene());
  E.setTool('select');
  onSelection([]);
  renderModebar(); renderCtx();
}
// 완료 뒤에는 만지지 못하게
export function setLocked(locked) {
  U.locked = locked;
  $('#editor').classList.toggle('locked', locked);
  if (U.editor) U.editor.enabled = !locked;
  paintTools();
  for (const b of $$('#strip .shape, #ctxbar button, #ctxbar input, #swatches .sw, #finishes .fin, #modebar .mbtn')) b.disabled = locked;
}
export function disposeEditor() { if (U.editor) { U.editor.dispose(); U.editor = null; } }
export function openHelp() { $('#help').classList.remove('hidden'); }
function closeHelp() { $('#help').classList.add('hidden'); }
export function downloadDataURL(url, name) {
  // data URL 을 Blob URL 로 바꿔 내려받는다(파일 이름이 확실히 붙고, 긴 data URL 도 안전)
  let href = url, revoke = null;
  try {
    const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(url);
    if (m && m[2]) { const bin = atob(m[3]); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); href = URL.createObjectURL(new Blob([u8], { type: m[1] || 'application/octet-stream' })); revoke = href; }
  } catch { /* 그대로 data URL 사용 */ }
  const a = el('a', { href, download: name }); document.body.append(a); a.click(); a.remove();
  if (revoke) setTimeout(() => URL.revokeObjectURL(revoke), 10000);
}

export const shotName = (tag = 'shot') => { const d = new Date(), z = n => String(n).padStart(2, '0'); return `polyguess-${tag}-${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}.png`; };
let msgTimer = 0;
function showEditorMsg(text) { const m = $('#editor-msg'); m.textContent = text; m.classList.add('show'); clearTimeout(msgTimer); msgTimer = setTimeout(() => m.classList.remove('show'), 3200); }

function buildPanels() {
  const E = U.editor;
  buildTools();
  // 왼쪽: 색 · 재질
  $('#swatches').replaceChildren(...PALETTE.map(c => el('button', { class: 'sw', style: `background:${c}`, 'data-color': c, title: c, 'aria-label': `색 ${c}`, onclick: () => { E.setColor(c); refreshColorUI(); } })));
  $('#finishes').replaceChildren(...FINISHES.map(f => el('button', { class: 'fin', 'data-finish': f.key, title: `${f.name}: ${f.help}`, 'aria-label': f.name, onclick: () => { E.setFinish(f.key); refreshColorUI(); } }, el('img', { src: U.thumbs.finishes.get(f.key), alt: f.name }))));
  refreshColorUI();
  // 아래: 도형 그림
  $('#strip').replaceChildren(...PRIMITIVES.map(p => el('button', { class: 'shape', 'data-kind': p.kind, title: `${p.name}: ${p.help}`, 'aria-label': p.name, onclick: () => E.addPrimitive(p.kind) }, el('img', { src: U.thumbs.shapes.get(p.kind), alt: p.name }))));
  // 노트 머리: 왼쪽 물체/점/선/면, 오른쪽 스크린샷·조작 모드
  renderModebar();
  const pt = $('#pad-tools');
  if (pt) {
    pt.replaceChildren(
      el('button', { class: 'pbtn', id: 'btn-shot', title: '스크린샷 저장 (지금 보이는 장면을 그림 파일로)', 'aria-label': '스크린샷 저장', html: ICONS.camera, onclick: () => { downloadDataURL(E.screenshot(), shotName()); showEditorMsg('그림 파일로 저장했어요 📷'); } }),
      el('label', { class: 'scheme', title: '조작 모드: 익숙한 프로그램의 마우스·단축키로 바꿔요' }, el('span', { class: 'ic', html: ICONS.mouse }),
        el('select', { id: 'scheme-select', 'aria-label': '조작 모드', onchange: e => E.setScheme(e.target.value) }, ...SCHEME_KEYS.map(k => el('option', { value: k, selected: k === E.schemeKey ? true : null }, SCHEMES[k].short)))),
    );
  }
  renderCtx();
}
function buildTools() {
  const E = U.editor, K = E.scheme.keys;
  $('#tools').replaceChildren(...ACTIONS.map(a => el('button', {
    class: `tbtn ${a.danger ? 'danger' : ''}`, 'data-key': a.key, 'data-tool': a.tool ? a.key : null, 'data-need': a.need || null,
    title: a.title(K), 'aria-label': a.title(K), html: ICONS[a.key],
    onclick: () => act(a),
  })));
  paintTools();
}
function act(a) {
  const E = U.editor;
  if (a.tool) return E.setTool(a.key);
  switch (a.key) {
    case 'snap': E.setSnap(!E.snap); paintTools(); break;
    case 'edit': E.toggleEdit(); break;
    case 'bevel': case 'loopcut': case 'extrude': case 'inset': E.beginOp(a.key); break;
    case 'duplicate': E.duplicate(); break;
    case 'mirror': E.mirror(); break;
    case 'drop': E.dropToFloor(); break;
    case 'remove': E.deleteSelected(); break;
    case 'light': E.addLight('sun'); break;
    case 'bg': E.setBackground((E.env.bg + 1) % BG_PRESETS.length); break;
    case 'help': openHelp(); break;
  }
}
// 버튼 켜짐/비활성 상태
function paintTools() {
  const E = U.editor; if (!E) return;
  const sel = E.selection, oneMesh = sel.length === 1 && sel[0].isMesh;
  for (const b of $$('#tools .tbtn')) {
    const k = b.dataset.key;
    if (b.dataset.tool) b.classList.toggle('on', E.tool === k);
    if (k === 'snap') b.classList.toggle('on', E.snap);
    if (k === 'edit') b.classList.toggle('on', E.edit.active);
    if (k === 'bevel' || k === 'loopcut' || k === 'extrude' || k === 'inset') b.classList.toggle('on', E.edit.op?.kind === k);
    let dis = U.locked && k !== 'help';
    if (b.dataset.need === 'sel') dis = dis || sel.length === 0;
    if (b.dataset.need === 'mesh') dis = dis || !(oneMesh || E.edit.active);
    if (k === 'sculpt') dis = dis || !E.canSculpt();
    b.disabled = dis;
  }
}
function refreshColorUI() {
  const E = U.editor; if (!E) return;
  for (const b of $$('#swatches .sw')) b.classList.toggle('on', b.dataset.color === E.color);
  for (const b of $$('#finishes .fin')) b.classList.toggle('on', b.dataset.finish === E.finish);
  const hex = $('#hex'); if (hex) hex.textContent = E.color;
}
function onSelection(sel) {
  const E = U.editor; if (!E) return;
  if (sel.length === 1 && E.tool !== 'paint') { E.color = sel[0].userData.mat.c; if (!isLight(sel[0])) E.finish = sel[0].userData.mat.f; }
  refreshColorUI(); paintTools(); renderModebar(); renderCtx();
}

// 노트 머리 왼쪽: 물체(Tab) / 점 1 / 선 2 / 면 3
function renderModebar() {
  const E = U.editor, bar = $('#modebar'); if (!E || !bar) return;
  const editing = E.edit.active, K = E.scheme.keys;
  const btn = (key, icon, digit, title, on, onclick) => el('button', { class: `mbtn ${on ? 'on' : ''}`, 'data-mode': key, title, 'aria-label': title, disabled: U.locked, onclick },
    el('span', { class: 'ic', html: ICONS[icon] }), el('span', { class: 'kb' }, digit));
  bar.replaceChildren(
    btn('object', 'object', keyLabel(K.edit), `물체 통째로 다루기 (${keyLabel(K.edit)}: 편집 모드 켜기/끄기)`, !editing, () => (editing ? E.exitEdit() : E.toggleEdit())),
    ...EDIT_MODES.map(m => btn(m.key, m.icon, m.digit, `${m.name} 고르기 — ${m.help} (${m.digit} 키)`, editing && E.edit.mode === m.key, () => E.setEditMode(m.key))),
  );
  bar.classList.toggle('editing', editing);
}

// 아래 줄(상황에 따라): 베벨/밀어내기/루프 자르기 조절 → 찰흙 붓 → 광원 조절 → 편집 안내
function renderCtx() {
  const E = U.editor, bar = $('#ctxbar'); if (!E || !bar) return;
  const op = E.edit.op, light = E.selectedLight();
  let kids = null;
  if (op) kids = opPanel(E, op);
  else if (E.tool === 'sculpt' && E.sculptor) kids = sculptPanel(E);
  else if (E.tool === 'paint') kids = paintPanel(E);
  else if (light) kids = lightPanel(E, light);
  else if (E.edit.active) kids = editHint(E);
  bar.classList.toggle('hidden', !kids);
  bar.replaceChildren(...(kids || []));
  if (U.locked) for (const b of bar.querySelectorAll('button, input, select')) b.disabled = true;
}
const range = (id, icon, min, max, step, value, title, oninput) => el('label', { class: 'range', title }, el('span', { class: 'ric', html: ICONS[icon] }),
  el('input', { type: 'range', id, min, max, step, value, 'aria-label': title, oninput: e => oninput(Number(e.target.value)) }));
const stepper = (id, icon, value, min, max, title, onchange) => el('span', { class: 'stepper mini', title },
  el('span', { class: 'ric', html: ICONS[icon] }),
  el('button', { type: 'button', 'aria-label': `${title} 줄이기`, disabled: value <= min, onclick: () => onchange(value - 1) }, '−'),
  el('b', { id }, String(value)),
  el('button', { type: 'button', 'aria-label': `${title} 늘리기`, disabled: value >= max, onclick: () => onchange(value + 1) }, '+'));
const okCancel = E => [el('span', { class: 'vsep' }),
  el('button', { class: 'tbtn ok', id: 'op-ok', title: '확정 (Enter)', 'aria-label': '확정', html: ICONS.check, onclick: () => E.confirmOp() }),
  el('button', { class: 'tbtn danger', id: 'op-cancel', title: '취소 (Esc)', 'aria-label': '취소', html: ICONS.close, onclick: () => E.cancelOp() })];
function opPanel(E, op) {
  const p = op.params;
  if (op.kind === 'bevel') return [
    el('span', { class: 'ctx-ic', html: ICONS.bevel, title: '베벨' }),
    range('op-width', 'size', OP_RANGE.width[0], OP_RANGE.width[1], 0.005, p.width, '깎는 폭', v => E.setOpParams({ width: v })),
    stepper('op-segments', 'smooth', Math.round(p.segments), OP_RANGE.segments[0], OP_RANGE.segments[1], '둥글기 단계 (1이면 한 번 깎기)', v => E.setOpParams({ segments: v })),
    ...okCancel(E)];
  if (op.kind === 'extrude') return [
    el('span', { class: 'ctx-ic', html: ICONS.extrude, title: '밀어내기' }),
    range('op-dist', 'move', OP_RANGE.dist[0], OP_RANGE.dist[1], 0.01, p.dist, '밀어내는 거리 (음수면 안쪽으로)', v => E.setOpParams({ dist: v })),
    ...okCancel(E)];
  if (op.kind === 'inset') return [
    el('span', { class: 'ctx-ic', html: ICONS.inset, title: '인셋' }),
    range('op-thickness', 'size', OP_RANGE.thickness[0], OP_RANGE.thickness[1], 0.005, p.thickness, '테두리 두께 (안쪽으로 얼마나 모을지)', v => E.setOpParams({ thickness: v })),
    range('op-depth', 'move', OP_RANGE.depth[0], OP_RANGE.depth[1], 0.01, p.depth, '깊이 (음수면 안으로 파이고, 양수면 튀어나와요)', v => E.setOpParams({ depth: v })),
    el('button', { class: `tbtn ${p.individual ? 'on' : ''}`, id: 'op-individual', title: '면마다 따로 (끄면 이어진 면들을 한 덩어리로 모아요)', 'aria-label': '면마다 따로', html: ICONS.individual, onclick: () => { E.setOpParams({ individual: !p.individual }); renderCtx(); } }),
    ...okCancel(E)];
  if (op.kind === 'loopcut') {
    if (op.phase === 'hover') return [
      el('span', { class: 'ctx-ic', html: ICONS.loopcut, title: '루프 자르기' }),
      stepper('op-cuts', 'loopcut', Math.round(p.cuts), OP_RANGE.cuts[0], OP_RANGE.cuts[1], '자르는 개수 (휠로도 바꿔요)', v => E.setOpParams({ cuts: v })),
      el('span', { class: 'hint' }, '모서리에 마우스를 올리면 노란 선이 보여요. 클릭해서 자르기'),
      el('span', { class: 'vsep' }),
      el('button', { class: 'tbtn danger', id: 'op-cancel', title: '취소 (Esc)', 'aria-label': '취소', html: ICONS.close, onclick: () => E.cancelOp() })];
    return [
      el('span', { class: 'ctx-ic', html: ICONS.loopcut, title: '루프 자르기' }),
      range('op-slide', 'move', OP_RANGE.slide[0], OP_RANGE.slide[1], 0.01, p.slide, '자른 선의 위치 (좌우로 밀기)', v => E.setOpParams({ slide: v })),
      el('span', { class: 'hint' }, '마우스를 좌우로 움직여 위치를 정하고 클릭'),
      ...okCancel(E)];
  }
  return null;
}
function sculptPanel(E) {
  return [
    ...BRUSHES.map(b => el('button', { class: `tbtn brush ${E.sculpt.brush === b.key ? 'on' : ''}`, 'data-brush': b.key, title: `${b.name}: ${b.help}`, 'aria-label': b.name, html: ICONS[b.key], onclick: () => { E.setSculpt({ brush: b.key }); renderCtx(); } })),
    el('span', { class: 'vsep' }),
    range('sculpt-size', 'size', 0.15, 2, 0.05, E.sculpt.size, '붓 크기', v => E.setSculpt({ size: v })),
    range('sculpt-strength', 'strength', 0.1, 1, 0.05, E.sculpt.strength, '세기', v => E.setSculpt({ strength: v })),
    el('button', { class: `tbtn ${E.sculpt.symmetry ? 'on' : ''}`, 'data-key': 'symmetry', title: '좌우 대칭 (한쪽을 만지면 반대쪽도 같이)', 'aria-label': '좌우 대칭', html: ICONS.symmetry, onclick: () => { E.setSculpt({ symmetry: !E.sculpt.symmetry }); renderCtx(); } }),
  ];
}
function paintPanel(E) {
  const sel = E.selection.filter(o => o.isMesh);
  return [
    el('span', { class: 'ctx-ic', html: ICONS.paint, title: '페인트' }),
    range('paint-size', 'size', 0.1, 2, 0.05, E.paint.size, '붓 크기 (맨 왼쪽이면 클릭한 면 하나만 칠해요)', v => E.setPaint({ size: v })),
    el('button', { class: `tbtn ${E.paint.eraser ? 'on' : ''}`, 'data-key': 'eraser', title: '지우개: 칠한 색을 지워 물체 색으로 되돌려요', 'aria-label': '지우개', html: ICONS.eraser, onclick: () => { E.setPaint({ eraser: !E.paint.eraser }); renderCtx(); } }),
    el('span', { class: 'vsep' }),
    el('button', { class: 'tbtn', 'data-key': 'fill', title: '고른 물체 전체를 지금 색으로 (칠한 면도 전부)', 'aria-label': '전체 칠하기', html: ICONS.fill, disabled: !sel.length, onclick: () => E.fillSelected() }),
    el('button', { class: 'tbtn', 'data-key': 'clearpaint', title: '고른 물체에 칠한 색을 전부 지워요', 'aria-label': '칠한 색 전부 지우기', html: ICONS.clearpaint, disabled: !sel.some(o => isPainted(o.userData.paint)), onclick: () => E.clearPaint() }),
    el('span', { class: 'hint' }, '왼쪽에서 색을 고르고 물체를 클릭하거나 문질러요'),
  ];
}
function lightPanel(E, light) {
  const L = light.userData.light, ang = E.lightAngles() || { elev: 55, azim: 35 };
  const kids = [
    ...LIGHT_TYPES_UI.map(t => el('button', { class: `tbtn ${L.type === t.key ? 'on' : ''}`, 'data-light': t.key, title: `${t.name}: ${t.help}`, 'aria-label': t.name, html: ICONS[t.icon], onclick: () => E.setLightProps({ type: t.key }) })),
    el('span', { class: 'vsep' }),
    range('light-i', 'strength', LIGHT_RANGE.intensity[0], LIGHT_RANGE.intensity[1], 0.1, L.i, '빛의 세기', v => E.setLightProps({ i: v })),
  ];
  if (L.type === 'spot') kids.push(range('light-a', 'spot', LIGHT_RANGE.angle[0], LIGHT_RANGE.angle[1], 1, L.a, '비추는 각도(원뿔 폭)', v => E.setLightProps({ a: v })));
  if (L.type !== 'point') kids.push(
    range('light-elev', 'angle', 5, 90, 1, ang.elev, '빛이 내려오는 높이 각도 (90이면 바로 위에서)', v => E.setLightAngles({ elev: v })),
    range('light-azim', 'rotate', 0, 359, 1, ang.azim, '빛이 오는 방향 (한 바퀴)', v => E.setLightAngles({ azim: v })),
  );
  return kids;
}
function editHint(E) {
  const m = EDIT_MODES.find(x => x.key === E.edit.mode), K = E.scheme.keys;
  return [
    el('span', { class: 'ctx-ic', html: ICONS[m.icon] }),
    el('span', { class: 'hint' }, `${m.name} ${E.edit.count}개 고름 · 클릭/Shift+클릭으로 고르고 이동·회전·크기 도구로 움직여요 · ${keyLabel(K.edit)}: 물체로 돌아가기`),
    el('span', { class: 'vsep' }),
    el('button', { class: 'tbtn', title: `전부 고르기 (${keyLabel(K.selectAll)})`, 'aria-label': '전부 고르기', html: ICONS.select, onclick: () => E.selectAll() }),
  ];
}

export function renderHelp() {
  const E = U.editor; if (!E) return;
  const K = E.scheme.keys, S = E.scheme;
  const row = (a, b) => `<tr><td>${a}</td><td>${b}</td></tr>`;
  const ic = k => `<span class="hic">${ICONS[k]}</span>`;
  $('#help-body').innerHTML = `
    <h3>마우스 — 조작 모드: ${esc(S.name)} <small>(노트 오른쪽 위에서 바꿀 수 있어요)</small></h3><table>
      ${S.mouseHelp.map(([a, b]) => row(a, esc(b))).join('')}
      ${row('도형 넣기', '아래 줄의 <b>도형 그림</b>을 누르면 바닥에 놓이고 바로 옮길 수 있어요')}
      ${row('색·재질', '왼쪽에서 고르면 선택한 도형에 바로 적용돼요. 아무것도 안 골랐으면 다음에 넣을 도형의 색이 돼요')}</table>
    <h3>오른쪽 도구</h3><table>${TOOLS.map(t => row(`${ic(t.icon)} ${t.name} ${kb(K[t.key])}`, esc(t.help))).join('')}
      ${row(`${ic('snap')} 격자`, '이동·회전·크기가 일정한 칸(0.25칸, 15도)으로 딱딱 맞춰져요')}
      ${row(`${ic('duplicate')} 복제 ${kb(K.duplicate)}`, `고른 것을 <b>제자리에</b> 하나 더 만들어요. 복사 ${kb(COMMON_KEYS.copy)} → 붙여넣기 ${kb(COMMON_KEYS.paste)}도 제자리에`)}
      ${row(`${ic('mirror')} 좌우 뒤집어 복제`, '왼쪽↔오른쪽을 뒤집은 복사본. 팔, 다리, 귀처럼 짝이 있는 것에')}
      ${row(`${ic('drop')} 바닥에 붙이기`, '떠 있는 것을 바닥에 딱 붙여요')}
      ${row(`${ic('remove')} 삭제 ${kb(K.remove)}`, '고른 것을 지워요 (편집 모드에서는 고른 면을 지워요)')}
      ${row(`${ic('light')} 광원`, '해·전구·스포트 빛을 넣어요. 회전 도구로 돌리거나 아래 줄 슬라이더로 높이·방향·세기를 바꿔요. 광원을 넣으면 기본 햇빛은 약해져요')}
      ${row(`${ic('bg')} 배경`, '누를 때마다 하늘·바닥 색이 바뀌어요')}
      ${row(`${ic('camera')} 스크린샷`, '노트 오른쪽 위. 지금 보이는 장면을 PNG 그림으로 저장해요')}</table>
    <h3>점·선·면 편집 (노트 왼쪽 위)</h3><table>
      ${row(`${ic('object')} 물체 ${kb(K.edit)}`, '도형을 통째로 다루는 보통 상태. 편집 중에 누르면 돌아와요')}
      ${EDIT_MODES.map(m => row(`${ic(m.icon)} ${m.name} <kbd>${m.digit}</kbd>`, `${esc(m.help)}. 도형 하나를 고른 뒤 누르면 편집 모드가 켜져요`)).join('')}
      ${row('고르기', '클릭, <kbd>Shift</kbd>+클릭으로 여러 개, 빈 곳에서 드래그로 네모 치기(기본 모드는 Shift+드래그), 선 모드에서 <kbd>Alt</kbd>+클릭은 한 바퀴')}
      ${row(`${ic('bevel')} 베벨 ${kb(K.bevel)}`, '고른 선(또는 점·면의 선)을 깎아요. 아래 줄에서 폭과 둥글기 단계를 조절하고 ✓')}
      ${row(`${ic('loopcut')} 루프 자르기 ${kb(K.loopcut)}`, '모서리에 마우스를 올리면 한 바퀴 노란 선이 보여요. 휠로 개수, 클릭으로 자른 뒤 좌우로 밀어 위치를 정하고 다시 클릭')}
      ${row(`${ic('extrude')} 밀어내기 ${kb(K.extrude)}`, '고른 면을 끌어내 새 덩어리를 만들어요. 거리는 아래 줄에서')}
      ${row(`${ic('inset')} 인셋 ${kb(K.inset)}`, '고른 면의 테두리를 안쪽으로 모아 안쪽 면 + 테두리 띠로 나눠요(블렌더 I). 두께·깊이(음수면 파임)·면마다 따로를 아래 줄에서. 면을 안 골랐으면 모든 면을 하나씩')}
      ${row('움직이기', '이동·회전·크기 도구가 고른 점·선·면에 그대로 적용돼요')}</table>
    <h3>페인트 (페인트 도구를 켜면 아래에 나와요)</h3><table>
      ${row(`${ic('paint')} 칠하기`, '왼쪽에서 색을 고르고 물체의 면을 클릭하거나 문질러요. 붓 크기가 맨 왼쪽이면 면 하나씩, 키우면 둥글게 여러 면')}
      ${row(`${ic('eraser')} 지우개`, '칠한 색을 지워 물체 본래 색으로')}
      ${row(`${ic('fill')} 전체 칠하기 / ${ic('clearpaint')} 전부 지우기`, '고른 물체 전체를 지금 색으로 / 칠한 색을 전부 지워요. 페인트로 클릭한 물체가 골라져요')}</table>
    <h3>찰흙 붓 (찰흙 도구를 켜면 아래에 나와요)</h3><table>${BRUSHES.map(b => row(`${ic(b.key)} ${b.name}`, esc(b.help))).join('')}
      ${row(`${ic('size')} / ${ic('strength')}`, '붓 크기 / 세기')}${row(`${ic('symmetry')} 좌우 대칭`, '한쪽을 만지면 반대쪽도 똑같이. 얼굴·몸통에 좋아요')}</table>
    <h3>키보드 (${esc(S.name)})</h3><table>
      ${row(kb(K.undo), '되돌리기')}${row(kb(K.redo), '다시 하기')}
      ${row(kb(K.remove), '고른 것 지우기')}${row(kb(K.selectAll), '전부 고르기')}${row(kb(K.frame), '고른 것이 잘 보이게 시점 맞추기')}
      ${row('<kbd>숫자패드 1</kbd> / <kbd>3</kbd> / <kbd>7</kbd>', '앞 / 옆 / 위에서 보기')}${row(kb(K.deselect), '선택 풀기 · 작업 취소')}${row('<kbd>Shift</kbd> (크기 조절 중)', '아주 조금씩 바꾸기')}</table>`;
}
