// 3D 만들기 도구. 도형 넣기, 이동/회전/크기, 색·재질, 복제(제자리)·복사/붙여넣기·좌우 뒤집어 복제, 찰흙, 페인트(면 색칠), 광원,
// 점·선·면 편집(editmode.js), 조작 모드별 카메라·단축키(schemes.js, camera.js), 되돌리기(Ctrl+Z/Y), 스크린샷.
import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { primitiveDef, makePrimitivePoly, replacePolyMesh, syncPaint } from './shapes.js';
import { createEnvironment, buildSceneInto, sceneToJSON, buildObject, objectToJSON, applyMaterial, disposeObject, sceneBounds, isLight, countLights } from './sceneio.js';
import { Sculptor } from './sculpt.js';
import { CameraRig } from './camera.js';
import { SCHEMES, COMMON_KEYS, loadSchemeKey, saveSchemeKey, matchKey, matchGesture } from './schemes.js';
import { EditMode } from './editmode.js';
import { setLightProps as applyLightProps, quaternionFromAngles, anglesFromQuaternion, defaultLightQuaternion } from './lights.js';
import { pmFlipX, pmFaceCenter, pmFaceNormal } from '../shared/polymesh.js';
import { makePaint, paintColorIndex, isPainted } from '../shared/paint.js';
import { emptyScene, PRIM_KINDS, SCENE_LIMITS, DEFAULT_LIGHT } from '../shared/scene.js';
import { t } from '../shared/i18n.js';

const ACCENT = 0x00e5a8;
const DOWN = new THREE.Vector3(0, -1, 0);
const isTyping = () => ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
const MIN_SCALE = 0.02;
export const PAINT_ONE = 0.1;   // 붓 크기가 이 값 이하면 클릭한 면 하나만 칠한다

export const TOOLS = [
  { key: 'select', name: t('선택'), icon: 'select', help: t('눌러서 고르기. Shift+클릭으로 여러 개') },
  { key: 'move', name: t('이동'), icon: 'move', help: t('화살표를 끌어서 자리를 옮겨요') },
  { key: 'rotate', name: t('회전'), icon: 'rotate', help: t('고리를 끌어서 돌려요 (광원은 빛 방향이 바뀌어요)') },
  { key: 'scale', name: t('크기'), icon: 'scale', help: t('네모를 끌어서 크기를 바꿔요. 가운데는 전체 크기, Shift 를 누르면 아주 조금씩') },
  { key: 'sculpt', name: t('찰흙'), icon: 'sculpt', help: t('도형 하나를 고른 뒤 표면을 문질러 모양을 바꿔요') },
  { key: 'paint', name: t('페인트'), icon: 'paint', help: t('왼쪽에서 색을 고르고 물체의 면을 클릭하거나 문질러 칠해요. 붓 크기·지우개는 아래 줄에') },
];

export class Editor {
  constructor(container, { onSelection, onHistory, onMessage, onTool, onChange, onEdit, onScheme } = {}) {
    this.container = container;
    Object.assign(this, { onSelection, onHistory, onMessage, onTool, onChange, onEdit, onScheme });
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'gl';
    this.canvas.tabIndex = 0;
    container.appendChild(this.canvas);
    this.boxEl = document.createElement('div'); this.boxEl.className = 'boxsel hidden'; container.appendChild(this.boxEl);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.05, 300);
    this.camera.position.set(6, 5, 8);
    this.env = createEnvironment(this.scene);
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.nextId = 1;
    this.selection = [];
    this.helpers = new Map();
    this.color = '#4dabf7'; this.finish = 'basic';
    this.tool = 'select'; this.snap = false; this.enabled = true;
    this.history = []; this.redoStack = [];
    this.frames = [];   // 타임랩스용: 처음부터 지금까지의 작업 스냅샷(JSON 문자열). 되돌리면 빠진다
    this.sculptor = null; this.sculpting = false;
    this.sculpt = { brush: 'inflate', size: 0.6, strength: 0.5, symmetry: true };
    this.paint = { size: 0.35, eraser: false };
    this.painting = false; this.paintObj = null; this.stroke = null;
    this.clipboard = null;
    this.ptr = { x: 0, y: 0 }; this.lastShift = false;

    // 카메라(조작 모드별 제스처)
    this.rig = new CameraRig(this.camera, this.canvas);
    this.schemeKey = loadSchemeKey(); this.scheme = SCHEMES[this.schemeKey];
    this.rig.setScheme(this.scheme);
    this.rig.onWheelHook = e => this.edit.wheel(e);

    // 점·선·면 편집
    this.edit = new EditMode(this);

    // 여러 개를 한꺼번에 움직이기 위한 중심축
    this.pivot = new THREE.Object3D();
    this.scene.add(this.pivot);
    this.tc = new TransformControls(this.camera, this.canvas);
    this.tc.setSize(0.85);
    this.tc.getHelper().userData.helper = true;
    this.scene.add(this.tc.getHelper());
    this.tc.addEventListener('dragging-changed', e => {
      if (e.value) { this.rig.cancel(); this.tcDragging = true; } else setTimeout(() => { this.tcDragging = false; }, 60);
    });
    this.tc.addEventListener('mouseDown', () => {
      this.pivot.updateMatrixWorld();
      this.pivotStart = this.pivot.matrixWorld.clone();
      this.scaleDrag = this.tool === 'scale' ? { x: this.ptr.x, y: this.ptr.y, start: this.pivot.scale.clone(), q: this.pivot.quaternion.clone(), p: this.pivot.position.clone() } : null;
      if (this.edit.active) this.edit.beginTransform();
      else this.startMatrices = this.selection.map(o => o.matrix.clone());
    });
    this.tc.addEventListener('objectChange', () => {
      if (!this.pivotStart) return;
      if (this.scaleDrag) this.overrideScale();
      this.pivot.updateMatrixWorld();
      const delta = this.pivot.matrixWorld.clone().multiply(this.pivotStart.clone().invert());
      if (this.edit.active) { this.edit.applyWorldDelta(delta); this.onChange?.(); return; }
      this.selection.forEach((o, i) => {
        o.matrix.copy(delta).multiply(this.startMatrices[i]);
        o.matrix.decompose(o.position, o.quaternion, o.scale);
        if (isLight(o)) o.scale.set(1, 1, 1);
        else for (const k of ['x', 'y', 'z']) if (Math.abs(o.scale[k]) < MIN_SCALE) o.scale[k] = Math.sign(o.scale[k] || 1) * MIN_SCALE;
      });
      this.onChange?.();
    });
    this.tc.addEventListener('mouseUp', () => {
      this.pivotStart = null; this.scaleDrag = null;
      if (this.edit.active) this.edit.endTransform(); else this.commit();
      this.updatePivot();
    });

    // 찰흙 브러시 커서
    this.cursor = new THREE.Mesh(new THREE.RingGeometry(0.88, 1, 48), new THREE.MeshBasicMaterial({ color: ACCENT, side: THREE.DoubleSide, depthTest: false, transparent: true, opacity: 0.9 }));
    this.cursor.renderOrder = 999; this.cursor.visible = false; this.cursor.userData.helper = true;
    this.scene.add(this.cursor);

    this.raycaster = new THREE.Raycaster();
    this.raycaster.params.Line.threshold = 0.08;
    this._onDownCapture = e => { this.ptr = { x: e.clientX, y: e.clientY }; this.lastShift = e.shiftKey; };
    this._onDown = e => this.pointerDown(e);
    this._onMove = e => this.pointerMove(e);
    this._onUp = e => this.pointerUp(e);
    this._onKey = e => this.keyDown(e);
    this.canvas.addEventListener('pointerdown', this._onDownCapture, true);
    this.canvas.addEventListener('pointerdown', this._onDown);
    this.canvas.addEventListener('pointermove', this._onMove);
    this.canvas.addEventListener('pointerup', this._onUp);
    this.canvas.addEventListener('pointercancel', this._onUp);
    this.canvas.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('keydown', this._onKey);

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.resize();
    this.alive = true;
    const loop = () => {
      if (!this.alive) return;
      this.rig.update();
      for (const h of this.helpers.values()) h.update();
      this.renderer.render(this.scene, this.camera);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
    this.load(emptyScene());
  }

  resize() {
    const w = this.container.clientWidth || 300, h = this.container.clientHeight || 200;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }
  message(text) { this.onMessage?.(text); }

  // ── 조작 모드 ──
  setScheme(key) {
    if (!SCHEMES[key]) return;
    this.schemeKey = key; this.scheme = SCHEMES[key];
    this.rig.setScheme(this.scheme);
    saveSchemeKey(key);
    this.onScheme?.(key);
  }

  // ── 저장/불러오기 ──
  toJSON() { return sceneToJSON(this.group, this.env.bg); }
  load(json, { keepHistory = false } = {}) {
    this.edit.exit();
    this.exitSculpt();
    this.setSelection([]);
    const objs = buildSceneInto(this.group, json);
    this.env.setBackground(json?.bg ?? 0);
    this.syncLights();
    this.nextId = objs.reduce((m, o) => Math.max(m, o.userData.id), 0) + 1;
    if (!keepHistory) { const snap = JSON.stringify(this.toJSON()); this.history = [snap]; this.frames = [snap]; this.redoStack = []; this.onHistory?.(); }
    this.onChange?.();
  }
  restore(json) {
    const ids = this.selection.map(o => o.userData.id);
    const wasSculpt = this.tool === 'sculpt';
    const wasEdit = this.edit.active ? { id: this.edit.obj.userData.id, mode: this.edit.mode } : null;
    this.load(json, { keepHistory: true });
    this.setSelection(this.group.children.filter(o => ids.includes(o.userData.id)));
    if (wasEdit) { const o = this.group.children.find(x => x.userData.id === wasEdit.id); if (o?.isMesh) { this.setSelection([o]); this.edit.enter(o, wasEdit.mode); this.updatePivot(); } }
    if (wasSculpt && this.selection.length === 1 && this.selection[0].isMesh) this.setTool('sculpt');
    else if (wasSculpt) this.onTool?.(this.tool);
  }
  commit() {
    this.syncLights();
    const snap = JSON.stringify(this.toJSON());
    if (snap === this.history[this.history.length - 1]) return;
    this.history.push(snap);
    if (this.history.length > 60) this.history.shift();
    this.frames.push(snap);
    if (this.frames.length > 600) this.frames = [this.frames[0], ...this.frames.slice(1, -1).filter((_, i) => i % 2 === 0), snap];   // 너무 길면 중간을 솎는다
    this.redoStack = [];
    this.onHistory?.(); this.onChange?.();
  }
  get canUndo() { return this.history.length > 1; }
  get canRedo() { return this.redoStack.length > 0; }
  undo() { if (!this.canUndo) return; this.redoStack.push(this.history.pop()); if (this.frames.length > 1) this.frames.pop(); this.restore(JSON.parse(this.history[this.history.length - 1])); this.onHistory?.(); }
  redo() { const s = this.redoStack.pop(); if (!s) return; this.history.push(s); this.frames.push(s); this.restore(JSON.parse(s)); this.onHistory?.(); }
  syncLights() { this.env.setUserLights(countLights(this.group)); }

  // ── 선택 ──
  setSelection(objs) {
    for (const h of this.helpers.values()) this.scene.remove(h);
    this.helpers.clear();
    this.selection = objs.filter(o => o && o.parent === this.group);
    if (this.edit.active && !(this.selection.length === 1 && this.selection[0] === this.edit.obj)) this.edit.exit();
    for (const o of this.selection) { const h = new THREE.BoxHelper(o, ACCENT); h.material.depthTest = false; h.renderOrder = 998; h.userData.helper = true; this.scene.add(h); this.helpers.set(o, h); }
    if (this.tool === 'sculpt' && !this.canSculpt()) this.setTool('select');
    else if (this.tool === 'sculpt') this.enterSculpt();
    this.updatePivot();
    this.onSelection?.(this.selection);
  }
  select(obj, add = false) {
    if (!obj) return add ? null : this.setSelection([]);
    if (add) this.setSelection(this.selection.includes(obj) ? this.selection.filter(o => o !== obj) : [...this.selection, obj]);
    else this.setSelection([obj]);
  }
  selectById(id, add = false) { this.select(this.group.children.find(o => o.userData.id === id), add); }
  selectAll() { if (this.edit.active) return this.edit.selectAll(); this.setSelection([...this.group.children]); }
  list() { return this.group.children.map(o => ({ id: o.userData.id, kind: o.userData.kind, name: nameOf(o), color: o.userData.mat.c, selected: this.selection.includes(o) })); }
  canSculpt() { return this.selection.length === 1 && this.selection[0].isMesh; }
  selectedLight() { return this.selection.length === 1 && isLight(this.selection[0]) ? this.selection[0] : null; }

  updatePivot() {
    const n = this.selection.length;
    const gizmoTool = this.tool === 'move' || this.tool === 'rotate' || this.tool === 'scale';
    if (this.edit.active) {
      const c = this.edit.selectionCenterWorld();
      if (!c || !gizmoTool || this.edit.op) { this.tc.detach(); return; }
      this.pivot.position.copy(c); this.pivot.quaternion.identity(); this.pivot.scale.set(1, 1, 1); this.pivot.updateMatrixWorld();
      this.tc.setMode({ move: 'translate', rotate: 'rotate', scale: 'scale' }[this.tool]);
      this.tc.setSpace('world');
      this.tc.showX = this.tc.showY = this.tc.showZ = true;
      this.tc.attach(this.pivot);
      return;
    }
    if (n === 0 || !gizmoTool || (this.tool === 'scale' && this.selection.some(isLight))) { this.tc.detach(); return; }
    if (n === 1) { this.pivot.position.copy(this.selection[0].position); this.pivot.quaternion.copy(this.selection[0].quaternion); }
    else { const box = new THREE.Box3(); for (const o of this.selection) box.expandByObject(o); box.getCenter(this.pivot.position); this.pivot.quaternion.identity(); }
    this.pivot.scale.set(1, 1, 1);
    this.pivot.updateMatrixWorld();
    this.tc.setMode({ move: 'translate', rotate: 'rotate', scale: 'scale' }[this.tool]);
    this.tc.setSpace(this.tool === 'move' || n > 1 ? 'world' : 'local');
    const uniformOnly = this.tool === 'scale' && n > 1;
    this.tc.showX = this.tc.showY = this.tc.showZ = !uniformOnly;
    this.tc.attach(this.pivot);
  }

  // 크기 조절을 포인터 이동량으로 계산해 미세하게(기즈모 기본 계산은 가운데를 잡으면 폭주한다)
  overrideScale() {
    const sd = this.scaleDrag, dx = this.ptr.x - sd.x, dy = this.ptr.y - sd.y, fine = this.lastShift ? 0.25 : 1;
    const axis = this.tc.axis || 'XYZ';
    const s = sd.start.clone();
    const apply = (k, f) => { let v = sd.start[k] * f; if (this.snap) v = Math.round(v / 0.1) * 0.1; s[k] = Math.max(MIN_SCALE, v); };
    if (axis.length === 1 && 'XYZ'.includes(axis)) {
      const k = axis.toLowerCase();
      const dir = new THREE.Vector3(k === 'x' ? 1 : 0, k === 'y' ? 1 : 0, k === 'z' ? 1 : 0);
      if (this.tc.space === 'local') dir.applyQuaternion(sd.q);
      const r = this.canvas.getBoundingClientRect();
      const toPx = v => { const p = v.clone().project(this.camera); return { x: (p.x + 1) / 2 * r.width, y: (1 - p.y) / 2 * r.height }; };
      const p0 = toPx(sd.p), p1 = toPx(sd.p.clone().add(dir));
      let ax = p1.x - p0.x, ay = p1.y - p0.y; const l = Math.hypot(ax, ay) || 1; ax /= l; ay /= l;
      apply(k, Math.exp((dx * ax + dy * ay) * 0.004 * fine));
    } else {
      const f = Math.exp((dx - dy) * 0.004 * fine);
      const ks = axis.replace(/[^XYZ]/g, '') || 'XYZ';
      for (const ch of (ks.length === 1 ? 'XYZ' : ks)) apply(ch.toLowerCase(), f);
    }
    this.pivot.scale.copy(s);
  }

  setTool(tool) {
    if (tool === 'sculpt') {
      if (!this.canSculpt()) { this.message(t('찰흙은 도형 하나를 고른 뒤 쓸 수 있어요')); return; }
      if (this.edit.active) this.edit.exit();
    }
    if (tool === 'paint' && this.edit.active) this.edit.exit();
    if (this.tool === 'sculpt' && tool !== 'sculpt') this.exitSculpt();
    if (this.tool === 'paint' && tool !== 'paint') this.exitPaint();
    this.tool = tool;
    if (tool === 'sculpt') this.enterSculpt();
    if (tool === 'paint') this.enterPaint();
    this.updatePivot();
    this.onTool?.(tool);
  }
  setSnap(on) {
    this.snap = on;
    this.tc.setTranslationSnap(on ? 0.25 : null);
    this.tc.setRotationSnap(on ? THREE.MathUtils.degToRad(15) : null);
  }

  // ── 넣기 ──
  spawnPoint() {
    const pt = new THREE.Vector3(this.rig.target.x, 0, this.rig.target.z);
    if (pt.length() > 14) pt.setScalar(0);
    for (let i = 0; i < 20 && this.group.children.some(o => Math.hypot(o.position.x - pt.x, o.position.z - pt.z) < 0.35); i++) pt.x += 0.7;
    return pt;
  }
  addPrimitive(kind) {
    if (!PRIM_KINDS.includes(kind)) return;
    if (this.group.children.length >= SCENE_LIMITS.objects) return this.message(t('도형은 {n}개까지예요', { n: SCENE_LIMITS.objects }));
    if (this.edit.active) this.edit.exit();
    const obj = buildObject({ id: this.nextId++, kind, p: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1], mat: { c: this.color, f: this.finish } });
    this.place(obj);
  }
  place(obj) {
    const pt = this.spawnPoint();
    obj.position.set(pt.x, 0, pt.z);
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj);
    obj.position.y = -box.min.y;
    this.group.add(obj);
    this.setSelection([obj]);
    if (this.tool === 'select') this.setTool('move');
    this.commit();
  }
  // 광원 넣기: 머리 위 비스듬한 자리에, 아래를 비추게
  addLight(type = 'sun') {
    if (countLights(this.group) >= SCENE_LIMITS.lights) return this.message(t('광원은 {n}개까지예요', { n: SCENE_LIMITS.lights }));
    if (this.edit.active) this.edit.exit();
    const pt = this.spawnPoint();
    const obj = buildObject({ id: this.nextId++, kind: 'light', p: [pt.x + 1.5, 3, pt.z + 1.5], q: defaultLightQuaternion().toArray(), s: [1, 1, 1], mat: { c: '#ffd23f', f: 'basic' }, light: { ...DEFAULT_LIGHT, type } });
    this.group.add(obj);
    this.setSelection([obj]);
    if (this.tool === 'select' || this.tool === 'scale') this.setTool('move');
    this.commit();
  }
  setLightProps(patch) {
    const lights = this.selection.filter(isLight);
    if (!lights.length) return;
    for (const l of lights) applyLightProps(l, patch);
    this.commit(); this.onSelection?.(this.selection);
  }
  lightAngles() { const l = this.selectedLight(); return l ? anglesFromQuaternion(l.quaternion) : null; }
  setLightAngles({ elev, azim }) {
    const l = this.selectedLight(); if (!l) return;
    const cur = anglesFromQuaternion(l.quaternion);
    l.quaternion.copy(quaternionFromAngles(elev ?? cur.elev, azim ?? cur.azim));
    this.updatePivot(); this.commit(); this.onSelection?.(this.selection);
  }

  // ── 편집 동작 ──
  remove() {
    if (!this.selection.length) return;
    if (this.edit.active) this.edit.exit();
    for (const o of this.selection) { this.group.remove(o); disposeObject(o); }
    this.setSelection([]);
    this.commit();
  }
  // Delete 키: 편집 모드면 고른 면을 지우고, 아니면 오브젝트를 지운다
  deleteSelected() {
    if (this.edit.active) {
      const r = this.edit.deleteSelected();
      if (r === 'all') this.remove();
      else if (!r) this.message(t('지울 점·선·면을 먼저 고르세요'));
      return;
    }
    this.remove();
  }
  cloneObjects(objs, transform = j => j) {
    const made = [];
    for (const o of objs) {
      if (this.group.children.length + made.length >= SCENE_LIMITS.objects) break;
      const j = transform(objectToJSON(o)); j.id = this.nextId++;
      if (j.kind === 'light' && countLights(this.group) + made.filter(isLight).length >= SCENE_LIMITS.lights) continue;
      const n = buildObject(j);
      if (j.kind === 'mesh' && transform.flip) replacePolyMesh(n, pmFlipX(n.userData.pm));
      this.group.add(n); made.push(n);
    }
    return made;
  }
  // 복제: 제자리에(겹쳐서) 만들고 그것을 고른 상태로 — 바로 옮기면 된다
  duplicate() {
    if (!this.selection.length) return;
    if (this.edit.active) this.edit.exit();
    const made = this.cloneObjects(this.selection);
    this.setSelection(made);
    if (this.tool === 'select') this.setTool('move');
    this.commit();
  }
  copy() {
    if (!this.selection.length) return;
    this.clipboard = this.selection.map(objectToJSON);
    this.message(t('{n}개를 복사했어요. Ctrl+V 로 제자리에 붙여 넣어요', { n: this.clipboard.length }));
  }
  paste() {
    if (!this.clipboard?.length) return;
    if (this.edit.active) this.edit.exit();
    const fake = this.clipboard.map(j => buildObject(j));
    const made = this.cloneObjects(fake);
    fake.forEach(disposeObject);
    this.setSelection(made);
    if (this.tool === 'select') this.setTool('move');
    this.commit();
  }
  // 왼쪽↔오른쪽(x=0 면 기준) 뒤집은 복사
  mirror() {
    if (!this.selection.length) return;
    if (this.edit.active) this.edit.exit();
    const tf = j => {
      j.p = [-j.p[0], j.p[1], j.p[2]];
      if (j.kind === 'light') { const d = DOWN.clone().applyQuaternion(new THREE.Quaternion().fromArray(j.q)); d.x = -d.x; j.q = new THREE.Quaternion().setFromUnitVectors(DOWN, d.normalize()).toArray(); }
      else j.q = [j.q[0], -j.q[1], -j.q[2], j.q[3]];
      return j;
    };
    tf.flip = true;
    const made = this.cloneObjects(this.selection, tf);
    this.setSelection(made);
    this.commit();
  }
  dropToFloor() {
    if (!this.selection.length) return;
    for (const o of this.selection) { if (isLight(o)) continue; o.updateMatrixWorld(true); const box = new THREE.Box3().setFromObject(o); o.position.y -= box.min.y; }
    this.updatePivot(); this.commit();
  }
  setColor(hex) {
    this.color = hex;
    if (this.tool === 'paint') { this.cursor.material.color.set(this.paint.eraser ? 0xffffff : hex); return; }   // 페인트 중에는 붓 색만 바뀐다
    for (const o of this.selection) applyMaterial(o, { c: hex, f: o.userData.mat.f });
    if (this.selection.length) this.commit();
  }
  setFinish(key) {
    this.finish = key;
    for (const o of this.selection) if (!isLight(o)) applyMaterial(o, { c: o.userData.mat.c, f: key });
    if (this.selection.length) this.commit();
  }
  setBackground(idx) { this.env.setBackground(idx); this.commit(); }

  // ── 점·선·면 편집 ──
  toggleEdit() {
    if (this.edit.active) { this.edit.exit(); this.updatePivot(); return; }
    this.setEditMode(this.edit.mode || 'vert');
  }
  setEditMode(mode) {
    if (this.edit.active) { this.edit.setMode(mode); this.updatePivot(); return; }
    if (!(this.selection.length === 1 && this.selection[0].isMesh)) { this.message(t('편집할 도형을 하나 고른 뒤 1·2·3(점·선·면)을 누르세요')); return; }
    if (this.tool === 'sculpt') this.setTool('select');
    this.edit.enter(this.selection[0], mode);
    this.updatePivot();
  }
  exitEdit() { if (this.edit.active) { this.edit.exit(); this.updatePivot(); } }
  beginOp(kind) {
    const needFaces = kind === 'extrude' || kind === 'inset';   // 밀어내기·인셋은 면을 고른 뒤에만(전체에 멋대로 적용되지 않게)
    if (!this.edit.active) {
      if (!(this.selection.length === 1 && this.selection[0].isMesh)) return this.message(t('도형을 하나 고른 뒤 쓸 수 있어요'));
      if (this.tool === 'sculpt' || this.tool === 'paint') this.setTool('select');
      this.edit.enter(this.selection[0], needFaces ? 'face' : kind === 'bevel' ? 'edge' : this.edit.mode);
      if (kind === 'bevel') this.edit.selectAll();
      if (needFaces) { this.updatePivot(); return this.message(t(kind === 'inset' ? '인셋할 면을 클릭해서 고른 뒤 다시 누르세요 (Shift+클릭으로 여러 개)' : '밀어내기할 면을 클릭해서 고른 뒤 다시 누르세요 (Shift+클릭으로 여러 개)')); }
    } else if (needFaces && !this.edit.facesTouching().size) {
      if (this.edit.mode !== 'face') { this.edit.setMode('face'); this.updatePivot(); }
      return this.message(t(kind === 'inset' ? '인셋할 면을 먼저 고르세요' : '밀어내기할 면을 먼저 고르세요'));
    }
    if (this.edit.beginOp(kind)) this.updatePivot();
  }
  confirmOp() { this.edit.confirmOp(); this.updatePivot(); }
  cancelOp() { this.edit.cancelOp(); this.updatePivot(); }
  setOpParams(patch) { this.edit.setOpParams(patch); }
  escape() {
    if (this.edit.op) return this.cancelOp();
    if (this.edit.active) { if (this.edit.count) { this.edit.clearSel(); } else this.exitEdit(); return; }
    this.setSelection([]);
  }

  // ── 찰흙 ──
  enterSculpt() {
    const o = this.selection[0];
    if (!o?.isMesh) return;
    if (!o.userData.sculptReady) {
      if (o.userData.kind !== 'mesh') replacePolyMesh(o, makePrimitivePoly(o.userData.kind, true)); // 기본 도형은 촘촘한 버전으로
      o.userData.kind = 'mesh'; o.userData.sculptReady = true;
    }
    this.sculptor = new Sculptor(o);
    Object.assign(this.sculptor, { brush: this.sculpt.brush, radius: this.sculpt.size, strength: this.sculpt.strength, symmetry: this.sculpt.symmetry });
    this.cursor.visible = true;
  }
  exitSculpt() { this.sculptor = null; this.sculpting = false; this.cursor.visible = false; this.rig.enabled = true; }
  setSculpt(opts) {
    Object.assign(this.sculpt, opts);
    if (this.sculptor) Object.assign(this.sculptor, { brush: this.sculpt.brush, radius: this.sculpt.size, strength: this.sculpt.strength, symmetry: this.sculpt.symmetry });
  }
  localRadius(mesh) { const s = mesh.scale; return this.sculpt.size / ((Math.abs(s.x) + Math.abs(s.y) + Math.abs(s.z)) / 3); }

  // ── 페인트(면 색칠) ──
  enterPaint() { this.cursor.visible = false; this.cursor.material.color.set(this.paint.eraser ? 0xffffff : this.color); }
  exitPaint() { this.painting = false; this.paintObj = null; this.stroke = null; this.cursor.visible = false; this.cursor.material.color.set(ACCENT); }
  setPaint(opts) {
    Object.assign(this.paint, opts);
    if (this.tool === 'paint') this.cursor.material.color.set(this.paint.eraser ? 0xffffff : this.color);
  }
  // 한 번 긋기 시작: 면 중심·법선을 미리 계산(로컬 좌표)
  beginStroke(obj) {
    const pm = obj.userData.pm, n = pm.f.length, centers = new Float32Array(n * 3), normals = new Float32Array(n * 3);
    for (let fi = 0; fi < n; fi++) { centers.set(pmFaceCenter(pm, fi), fi * 3); normals.set(pmFaceNormal(pm, fi), fi * 3); }
    this.stroke = { obj, centers, normals };
  }
  paintAt({ obj, hit }) {
    const u = obj.userData; if (!u.pm || !u.buffers || !this.stroke || this.stroke.obj !== obj) return;
    if (!u.paint || u.paint.f.length !== u.pm.f.length) u.paint = makePaint(u.pm.f.length);
    const k = this.paint.eraser ? 0 : paintColorIndex(u.paint, this.color);
    const f = u.paint.f, fi0 = u.buffers.triFace[hit.faceIndex];
    let changed = false;
    const put = fi => { if (f[fi] !== k) { f[fi] = k; changed = true; } };
    if (this.paint.size <= PAINT_ONE) put(fi0);
    else {
      const lp = obj.worldToLocal(hit.point.clone()), s = obj.scale;
      const r = this.paint.size / ((Math.abs(s.x) + Math.abs(s.y) + Math.abs(s.z)) / 3), r2 = r * r;
      const { centers: C, normals: N } = this.stroke, hn = hit.face.normal;
      for (let fi = 0; fi < f.length; fi++) {
        const dx = C[fi * 3] - lp.x, dy = C[fi * 3 + 1] - lp.y, dz = C[fi * 3 + 2] - lp.z;
        if (dx * dx + dy * dy + dz * dz > r2) continue;
        if (N[fi * 3] * hn.x + N[fi * 3 + 1] * hn.y + N[fi * 3 + 2] * hn.z < 0.05) continue;   // 뒷면·옆면은 빼고(판 윗면만 칠할 때)
        put(fi);
      }
    }
    if (changed) { syncPaint(obj); this.onChange?.(); }
  }
  placePaintCursor(hit) {
    const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
    this.cursor.position.copy(hit.point).addScaledVector(n, 0.01);
    this.cursor.lookAt(hit.point.clone().add(n));
    this.cursor.scale.setScalar(this.paint.size <= PAINT_ONE ? 0.12 : this.paint.size);
  }
  // 고른 물체 전체를 지금 색으로(칠한 면도 전부) / 칠한 색만 지우기
  fillSelected() {
    const objs = this.selection.filter(o => o.isMesh);
    if (!objs.length) return this.message(t('칠할 물체를 먼저 고르세요 (페인트로 클릭하면 골라져요)'));
    for (const o of objs) { o.userData.paint = null; applyMaterial(o, { c: this.color, f: o.userData.mat.f }); }
    this.commit(); this.onSelection?.(this.selection);
  }
  clearPaint() {
    const objs = this.selection.filter(o => o.isMesh && isPainted(o.userData.paint));
    if (!objs.length) return this.message(t('칠한 색이 있는 물체를 먼저 고르세요'));
    for (const o of objs) { o.userData.paint = null; syncPaint(o); }
    this.commit(); this.onSelection?.(this.selection);
  }

  // ── 포인터 ──
  ndc(e) {
    const r = this.canvas.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }
  hitObject(e, obj) {
    this.raycaster.setFromCamera(this.ndc(e), this.camera);
    return this.raycaster.intersectObject(obj, false)[0] || null;
  }
  hitAny(e) {
    this.raycaster.setFromCamera(this.ndc(e), this.camera);
    const hits = this.raycaster.intersectObjects(this.group.children, true);
    if (!hits.length) return null;
    let obj = hits[0].object;
    while (obj && obj.parent !== this.group) obj = obj.parent;
    return obj ? { obj, hit: hits[0] } : null;
  }
  pointerDown(e) {
    if (!this.enabled) return;
    this.canvas.focus({ preventScroll: true });
    this.ptr = { x: e.clientX, y: e.clientY }; this.lastShift = e.shiftKey;
    if (this.tc.axis || this.tc.dragging) return;
    // 찰흙 칠하기
    if (this.tool === 'sculpt' && this.sculptor && e.button === 0 && e.pointerType !== 'touch' || (this.tool === 'sculpt' && this.sculptor && e.pointerType === 'touch' && this.rig.touches.size === 0)) {
      const mesh = this.sculptor.mesh, hit = this.hitObject(e, mesh);
      if (hit) {
        this.sculpting = true;
        this.canvas.setPointerCapture(e.pointerId);
        const lp = mesh.worldToLocal(hit.point.clone());
        const ln = hit.face.normal.clone();
        this.sculptor.radius = this.localRadius(mesh);
        this.sculptor.begin(lp, ln);
        const nrm = this.camera.getWorldDirection(new THREE.Vector3()).negate();
        this.dragPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(nrm, hit.point);
        this.dragStart = hit.point.clone();
        this.sculptor.move(lp, ln, null);
        return;
      }
    }
    // 페인트: 물체 위에서 누르면 칠하기 시작(빈 곳은 카메라)
    if (this.tool === 'paint' && ((e.button === 0 && e.pointerType !== 'touch') || (e.pointerType === 'touch' && this.rig.touches.size === 0))) {
      const over = this.hitAny(e);
      if (over && over.obj.isMesh) {
        this.painting = true; this.paintObj = over.obj;
        this.canvas.setPointerCapture(e.pointerId);
        this.beginStroke(over.obj);
        this.paintAt(over);
        this.placePaintCursor(over.hit); this.cursor.visible = true;
        if (!(this.selection.length === 1 && this.selection[0] === over.obj)) this.setSelection([over.obj]);
        return;
      }
    }
    // 루프 자르기 중 클릭
    if (this.edit.op?.kind === 'loopcut' && e.button === 0) { if (this.edit.loopCutClick(e)) return; }
    // 베벨·밀어내기·인셋 중: 왼쪽 클릭 확정, 오른쪽 클릭 취소(블렌더처럼). 휠 버튼은 시점 돌리기로 넘어간다
    if (this.edit.op && this.edit.op.kind !== 'loopcut' && e.pointerType !== 'touch') {
      if (e.button === 0) { this.confirmOp(); return; }
      if (e.button === 2) { this.cancelOp(); return; }
    }
    const over = this.hitAny(e);
    const kind = this.rig.begin(e, { overObject: !!over });
    if (kind) { this.dragKind = kind; this.canvas.setPointerCapture(e.pointerId); return; }
    // 네모 치기(점·선·면 편집 중이거나 오브젝트 여러 개 고르기)
    const bg = this.scheme.box;
    if (bg && matchGesture(bg, e) && (!bg.emptyOnly || !over) && e.pointerType !== 'touch') {
      this.boxSel = { x: e.clientX, y: e.clientY, add: e.shiftKey && !bg.mods.includes('shift') ? true : (this.scheme.key !== 'basic' && this.scheme.key !== 'zbrush' ? e.shiftKey : false) };
      this.canvas.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button === 0 || e.pointerType === 'touch') this._down = { x: e.clientX, y: e.clientY, over, shift: e.shiftKey, alt: e.altKey };
  }
  pointerMove(e) {
    this.ptr = { x: e.clientX, y: e.clientY }; this.lastShift = e.shiftKey;
    if (this.rig.dragging) { this.rig.move(e); return; }
    if (this.boxSel) { this.drawBox(e); return; }
    if (this.edit.op?.kind === 'loopcut') { this.edit.hoverMove(e); return; }
    if (this.edit.op && this.edit.opMouseMove(e)) return;
    if (this.painting) {
      const over = this.hitAny(e);
      if (over && over.obj === this.paintObj) { this.paintAt(over); this.placePaintCursor(over.hit); }
      return;
    }
    if (this.tool === 'paint') {
      const over = this.hitAny(e);
      this.cursor.visible = !!(over && over.obj.isMesh);
      if (this.cursor.visible) this.placePaintCursor(over.hit);
      return;
    }
    if (this.tool !== 'sculpt' || !this.sculptor) return;
    const mesh = this.sculptor.mesh;
    if (this.sculpting) {
      if (this.sculptor.brush === 'grab') {
        this.raycaster.setFromCamera(this.ndc(e), this.camera);
        const cur = new THREE.Vector3();
        if (!this.raycaster.ray.intersectPlane(this.dragPlane, cur)) return;
        const inv = mesh.matrixWorld.clone().invert();
        const delta = cur.clone().applyMatrix4(inv).sub(this.dragStart.clone().applyMatrix4(inv));
        this.sculptor.move(null, null, delta);
        this.cursor.position.copy(cur);
      } else {
        const hit = this.hitObject(e, mesh);
        if (!hit) return;
        this.sculptor.move(mesh.worldToLocal(hit.point.clone()), hit.face.normal.clone(), null);
        this.placeCursor(hit);
      }
      this.onChange?.();
    } else {
      const hit = this.hitObject(e, mesh);
      this.cursor.visible = !!hit;
      if (hit) this.placeCursor(hit);
    }
  }
  placeCursor(hit) {
    const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
    this.cursor.position.copy(hit.point).addScaledVector(n, 0.01);
    this.cursor.lookAt(hit.point.clone().add(n));
    this.cursor.scale.setScalar(this.sculpt.size);
  }
  drawBox(e) {
    const r = this.canvas.getBoundingClientRect(), b = this.boxSel;
    const x0 = Math.min(b.x, e.clientX) - r.left, y0 = Math.min(b.y, e.clientY) - r.top, w = Math.abs(e.clientX - b.x), h = Math.abs(e.clientY - b.y);
    Object.assign(this.boxEl.style, { left: `${x0}px`, top: `${y0}px`, width: `${w}px`, height: `${h}px` });
    this.boxEl.classList.toggle('hidden', w < 4 && h < 4);
  }
  finishBox(e) {
    const b = this.boxSel; this.boxSel = null; this.boxEl.classList.add('hidden');
    const r = this.canvas.getBoundingClientRect();
    const x0 = b.x - r.left, y0 = b.y - r.top, x1 = e.clientX - r.left, y1 = e.clientY - r.top;
    if (Math.abs(x1 - x0) < 4 && Math.abs(y1 - y0) < 4) { // 그냥 클릭
      if (this.edit.active) { if (!this.edit.pick(e, e.shiftKey)) { const over = this.hitAny(e); if (over && over.obj !== this.edit.obj) this.select(over.obj); } }
      else { const over = this.hitAny(e); this.select(over?.obj || null, e.shiftKey); }
      return;
    }
    if (this.edit.active) { this.edit.boxSelect(x0, y0, x1, y1, b.add); return; }
    const inside = o => { const p = o.position.clone().project(this.camera); const sx = (p.x + 1) / 2 * r.width, sy = (1 - p.y) / 2 * r.height; return sx >= Math.min(x0, x1) && sx <= Math.max(x0, x1) && sy >= Math.min(y0, y1) && sy <= Math.max(y0, y1); };
    const picked = this.group.children.filter(inside);
    this.setSelection(b.add ? [...new Set([...this.selection, ...picked])] : picked);
  }
  pointerUp(e) {
    if (this.painting) {
      this.painting = false; this.paintObj = null;
      this.commit();
      return;
    }
    if (this.sculpting) {
      this.sculpting = false;
      this.sculptor?.end();
      this.commit();
      return;
    }
    if (this.rig.dragging) { this.rig.end(e); this.dragKind = null; return; }
    if (this.boxSel) { this.finishBox(e); return; }
    if (!this._down) return;
    const d = this._down; this._down = null;
    const moved = Math.hypot(e.clientX - d.x, e.clientY - d.y);
    if (moved > 6 || this.tcDragging || this.tc.axis) return;
    if (this.tool === 'sculpt' || this.tool === 'paint') return;
    if (this.edit.active) {
      if (d.alt ? this.edit.pickLoop(e, d.shift) : this.edit.pick(e, d.shift)) return;
      const over = this.hitAny(e);
      if (over && over.obj !== this.edit.obj) this.select(over.obj);
      return;
    }
    const over = this.hitAny(e);
    this.select(over?.obj || null, d.shift);
  }
  keyDown(e) {
    if (!this.enabled || isTyping()) return;
    const K = this.scheme.keys, C = COMMON_KEYS;
    const on = (b, fn) => { if (matchKey(b, e)) { e.preventDefault(); fn(); return true; } return false; };
    if (on(K.undo, () => this.undo())) return;
    if (on(K.redo, () => this.redo())) return;
    if (on(C.copy, () => this.copy())) return;
    if (on(C.paste, () => this.paste())) return;
    if (on(K.duplicate, () => this.duplicate())) return;
    if (on(K.selectAll, () => this.selectAll())) return;
    if (on(K.deselect, () => this.escape())) return;
    if (on(K.remove, () => this.deleteSelected())) return;
    if (on(K.frame, () => this.focusSelection())) return;
    if (on(K.edit, () => this.toggleEdit())) return;
    if (on(C.vert, () => this.setEditMode('vert'))) return;
    if (on(C.edge, () => this.setEditMode('edge'))) return;
    if (on(C.face, () => this.setEditMode('face'))) return;
    if (on(K.bevel, () => this.beginOp('bevel'))) return;
    if (on(K.loopcut, () => this.beginOp('loopcut'))) return;
    if (on(K.extrude, () => this.beginOp('extrude'))) return;
    if (on(K.inset, () => (this.edit.op?.kind === 'inset' ? this.edit.toggleIndividual() : this.beginOp('inset')))) return;
    for (const t of ['select', 'move', 'rotate', 'scale', 'sculpt', 'paint']) if (on(K[t], () => this.setTool(t))) return;
    if (e.code === 'Enter' && this.edit.op) { e.preventDefault(); this.confirmOp(); return; }
    const v = K.views?.[e.code];
    if (v && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); this.setView(v); }
  }

  // ── 시점 ──
  selectionBox() { return sceneBounds(this.selection.length ? { children: this.selection } : this.group); }
  focusSelection() {
    if (this.edit.active) { const c = this.edit.selectionCenterWorld(); if (c) { const b = new THREE.Box3().setFromCenterAndSize(c, new THREE.Vector3(1, 1, 1)); this.rig.fitBox(b, 1.4); return; } }
    this.rig.fitBox(this.selectionBox(), this.selection.length ? 1.6 : 1.25);
  }
  setView(name) { this.rig.setView(name, this.selectionBox()); }

  // 지금 보이는 장면을 그림(PNG)으로. 기즈모·선택 테두리·광원 표시는 빼고 찍는다.
  screenshot() {
    const hidden = [];
    const hide = o => { if (o && o.visible) { o.visible = false; hidden.push(o); } };
    this.scene.traverse(o => { if (o.userData?.helper) hide(o); });
    for (const h of this.helpers.values()) hide(h);
    hide(this.cursor);
    this.renderer.render(this.scene, this.camera);
    const url = this.canvas.toDataURL('image/png');
    for (const o of hidden) o.visible = true;
    return url;
  }

  dispose() {
    this.alive = false;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    window.removeEventListener('keydown', this._onKey);
    this.canvas.removeEventListener('pointerdown', this._onDownCapture, true);
    this.canvas.removeEventListener('pointerdown', this._onDown);
    this.canvas.removeEventListener('pointermove', this._onMove);
    this.canvas.removeEventListener('pointerup', this._onUp);
    this.canvas.removeEventListener('pointercancel', this._onUp);
    this.edit.exit();
    this.tc.detach(); this.tc.dispose(); this.rig.dispose();
    buildSceneInto(this.group, null);
    this.renderer.dispose(); this.renderer.forceContextLoss?.();
    this.canvas.remove(); this.boxEl.remove();
  }
}

export function nameOf(o) {
  const u = o.userData;
  if (u.kind === 'mesh') return t('다듬은 도형');
  if (u.kind === 'light') return t({ sun: '해', point: '전구', spot: '스포트' }[u.light?.type] || '광원');
  return primitiveDef(u.kind)?.name || u.kind;
}
