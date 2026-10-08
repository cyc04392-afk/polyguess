// 편집 모드: 도형 하나의 점·선·면을 고르고(1·2·3), 옮기고, 베벨·루프 자르기·밀어내기·인셋·삭제를 한다.
import * as THREE from 'three';
import { pmEdges, edgeKey, clonePolyMesh } from '../shared/polymesh.js';
import { edgeRing, edgeLoop, loopCut, bevelEdges, deleteFaces, extrudeFaces, insetFaces, edgesOfSelection } from '../shared/meshops.js';
import { snapshotTex } from './texpaint.js';
import { replacePolyMesh, syncGeometry } from './shapes.js';
import { t } from '../shared/i18n.js';

export const EDIT_MODES = [
  { key: 'vert', name: t('점'), icon: 'vert', digit: '1', help: t('꼭짓점을 골라 옮겨요') },
  { key: 'edge', name: t('선'), icon: 'edge', digit: '2', help: t('모서리를 골라요. Alt+클릭은 한 바퀴 선택') },
  { key: 'face', name: t('면'), icon: 'face', digit: '3', help: t('면을 골라 옮기거나 밀어내요') },
];
export const OP_DEFAULTS = { bevel: { width: 0.08, segments: 1 }, extrude: { dist: 0.3 }, loopcut: { cuts: 1, slide: 0 }, inset: { thickness: 0.1, depth: 0, individual: false } };
export const OP_RANGE = { width: [0.01, 0.5], segments: [1, 6], dist: [-1, 1.5], cuts: [1, 10], slide: [-0.95, 0.95], thickness: [0.01, 0.5], depth: [-1, 1] };

const SEL = 0xff9f1a, WIRE = 0x1b1b2a, HOVER = 0xffe066;
const SELC = new THREE.Color(SEL), DOTC = new THREE.Color(0x24243a);
let dotTexture = null;
function getDotTexture() {
  if (dotTexture) return dotTexture;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.beginPath(); g.arc(32, 32, 26, 0, Math.PI * 2); g.fill();
  g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,.35)'; g.stroke();
  dotTexture = new THREE.CanvasTexture(c);
  return dotTexture;
}
const noRaycast = () => {};

export class EditMode {
  constructor(editor) {
    this.E = editor;
    this.obj = null; this.mode = 'vert';
    this.sel = { verts: new Set(), edges: new Set(), faces: new Set() };
    this.op = null;
    this.overlay = null;
    this.tStart = null;
  }
  get active() { return !!this.obj; }
  get pm() { return this.obj?.userData.pm; }
  changed() { this.E.onEdit?.(); }
  markMesh() { if (this.obj && this.obj.userData.kind !== 'mesh') this.obj.userData.kind = 'mesh'; } // 기본 도형도 손대면 '다듬은 도형'이 된다

  // ── 들어가기 / 나가기 ──
  enter(obj, mode) {
    if (!obj?.isMesh) return false;
    if (this.obj && this.obj !== obj) this.exit();
    this.obj = obj;
    if (mode) this.mode = mode;
    obj.material.polygonOffset = true; obj.material.polygonOffsetFactor = 1; obj.material.polygonOffsetUnits = 1; obj.material.needsUpdate = true;
    this.rebuild();
    this.changed();
    return true;
  }
  exit() {
    if (!this.obj) return;
    if (this.op) this.cancelOp();
    this.removeOverlay();
    const m = this.obj.material; m.polygonOffset = false; m.needsUpdate = true;
    this.obj = null;
    this.clearSel(false);
    this.changed();
  }
  // 위상이 바뀐 뒤(또는 처음): 모서리 목록·표시를 다시 만든다. 선택은 비운다.
  rebuild() {
    this.edges = pmEdges(this.pm);
    this.buildOverlay();
    this.clearSel(false);
  }

  // ── 표시(점·선·선택 면) ──
  removeOverlay() {
    if (!this.overlay) return;
    this.overlay.parent?.remove(this.overlay);
    this.overlay.traverse(o => { o.geometry?.dispose?.(); if (o.material && o !== this.overlay) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose()); });
    this.overlay = null;
  }
  buildOverlay() {
    this.removeOverlay();
    const pm = this.pm, g = new THREE.Group();
    g.userData.overlay = true; g.userData.helper = true;
    // 모든 모서리
    const wirePos = new Float32Array(this.edges.list.length * 6);
    this.wire = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(wirePos, 3)), new THREE.LineBasicMaterial({ color: WIRE, transparent: true, opacity: 0.6 }));
    // 모든 점
    const n = pm.v.length;
    const ptsGeo = new THREE.BufferGeometry();
    ptsGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    ptsGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    this.pts = new THREE.Points(ptsGeo, new THREE.PointsMaterial({ size: 9, sizeAttenuation: false, vertexColors: true, map: getDotTexture(), alphaTest: 0.5, transparent: true }));
    this.pts.renderOrder = 5;
    // 고른 선 · 고른 면 · 미리보기
    this.selE = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: SEL, depthTest: false, transparent: true, opacity: 0.95 }));
    this.selE.renderOrder = 6;
    this.selF = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: SEL, transparent: true, opacity: 0.42, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    this.hover = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: HOVER, depthTest: false, transparent: true, opacity: 1 }));
    this.hover.renderOrder = 7;
    for (const o of [this.wire, this.pts, this.selE, this.selF, this.hover]) { o.raycast = noRaycast; o.userData.helper = true; o.frustumCulled = false; g.add(o); }
    this.obj.add(g);
    this.overlay = g;
    this.updatePositions(false);
    this.refreshSel();
  }
  // 정점 위치가 바뀐 뒤: 지오메트리와 표시를 함께 갱신
  updatePositions(sync = true) {
    if (!this.obj) return;
    const pm = this.pm;
    if (sync) syncGeometry(this.obj);
    const wp = this.wire.geometry.attributes.position.array;
    this.edges.list.forEach((e, i) => { const a = pm.v[e.a], b = pm.v[e.b]; wp.set(a, i * 6); wp.set(b, i * 6 + 3); });
    this.wire.geometry.attributes.position.needsUpdate = true;
    const pp = this.pts.geometry.attributes.position.array;
    pm.v.forEach((v, i) => pp.set(v, i * 3));
    this.pts.geometry.attributes.position.needsUpdate = true;
    this.pts.geometry.computeBoundingSphere();
    this.refreshSel();
  }
  refreshSel() {
    if (!this.obj || !this.overlay) return;
    const pm = this.pm;
    // 점 색
    const col = this.pts.geometry.attributes.color.array;
    const vsel = this.selectedVertexSet();
    for (let i = 0; i < pm.v.length; i++) { const c = vsel.has(i) ? SELC : DOTC; col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    this.pts.geometry.attributes.color.needsUpdate = true;
    this.pts.visible = this.mode === 'vert';
    // 선
    const eArr = [];
    const edgeSet = this.mode === 'edge' ? this.sel.edges : this.mode === 'face' ? this.edgesOfFaces(this.sel.faces) : new Set();
    for (const ei of edgeSet) { const e = this.edges.list[ei]; if (e) eArr.push(...pm.v[e.a], ...pm.v[e.b]); }
    this.selE.geometry.dispose(); this.selE.geometry.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(eArr), 3));
    this.selE.visible = eArr.length > 0;
    // 면
    const fArr = [];
    if (this.mode === 'face') for (const fi of this.sel.faces) { const f = pm.f[fi]; if (!f) continue; const c = faceCenter(pm, fi); for (let k = 0; k < f.length; k++) fArr.push(...pm.v[f[k]], ...pm.v[f[(k + 1) % f.length]], ...c); }
    this.selF.geometry.dispose(); this.selF.geometry.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(fArr), 3));
    this.selF.visible = fArr.length > 0;
  }
  setHoverLines(points) { // [[x,y,z],[x,y,z], ...] 쌍들
    const arr = []; for (const p of points) arr.push(...p);
    this.hover.geometry.dispose(); this.hover.geometry.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(arr), 3));
    this.hover.visible = arr.length > 0;
  }

  // ── 선택 ──
  clearSel(notify = true) { this.sel.verts.clear(); this.sel.edges.clear(); this.sel.faces.clear(); if (this.obj) this.refreshSel(); if (notify) this.afterSelect(); }
  afterSelect() { this.E.updatePivot(); this.changed(); }
  edgesOfFaces(faces) { const s = new Set(); for (const fi of faces) { const f = this.pm.f[fi]; if (!f) continue; for (let k = 0; k < f.length; k++) { const ei = this.edges.index.get(edgeKey(f[k], f[(k + 1) % f.length])); if (ei !== undefined) s.add(ei); } } return s; }
  selectedVertexSet() {
    const s = new Set();
    if (this.mode === 'vert') return new Set(this.sel.verts);
    if (this.mode === 'edge') for (const ei of this.sel.edges) { const e = this.edges.list[ei]; if (e) { s.add(e.a); s.add(e.b); } }
    if (this.mode === 'face') for (const fi of this.sel.faces) for (const vi of this.pm.f[fi] || []) s.add(vi);
    return s;
  }
  selectedVertexIndices() { return [...this.selectedVertexSet()]; }
  get count() { return this.mode === 'vert' ? this.sel.verts.size : this.mode === 'edge' ? this.sel.edges.size : this.sel.faces.size; }
  selectAll() {
    const pm = this.pm;
    if (this.mode === 'vert') pm.v.forEach((_, i) => this.sel.verts.add(i));
    else if (this.mode === 'edge') this.edges.list.forEach((_, i) => this.sel.edges.add(i));
    else pm.f.forEach((_, i) => this.sel.faces.add(i));
    this.refreshSel(); this.afterSelect();
  }
  // 모드를 바꾸면 선택을 그대로 옮긴다(블렌더처럼): 점→선은 양 끝이 다 골라진 선, 선→면은 모든 선이 골라진 면 …
  setMode(mode) {
    if (!EDIT_MODES.some(m => m.key === mode) || mode === this.mode) { this.changed(); return; }
    const pm = this.pm, vs = this.selectedVertexSet();
    const next = { verts: new Set(), edges: new Set(), faces: new Set() };
    if (mode === 'vert') next.verts = vs;
    else if (mode === 'edge') this.edges.list.forEach((e, i) => { if (vs.has(e.a) && vs.has(e.b)) next.edges.add(i); });
    else pm.f.forEach((f, i) => { if (f.every(vi => vs.has(vi))) next.faces.add(i); });
    // 점 하나만 골랐을 때 선/면으로 가면 아무것도 안 남으니, 그 점을 포함한 선/면을 고른다
    if (this.mode === 'vert' && vs.size === 1 && mode !== 'vert') {
      const [v0] = vs;
      if (mode === 'edge') this.edges.list.forEach((e, i) => { if (e.a === v0 || e.b === v0) next.edges.add(i); });
      else pm.f.forEach((f, i) => { if (f.includes(v0)) next.faces.add(i); });
    }
    this.sel = next; this.mode = mode;
    this.refreshSel(); this.afterSelect();
  }

  // 화면 좌표 도우미
  screenOf(localArr) {
    const v = new THREE.Vector3(...localArr).applyMatrix4(this.obj.matrixWorld).project(this.E.camera);
    const r = this.E.canvas.getBoundingClientRect();
    return { x: (v.x + 1) / 2 * r.width, y: (1 - v.y) / 2 * r.height, z: v.z };
  }
  ptr(e) { const r = this.E.canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  hit(e) { return this.E.hitObject(e, this.obj); }
  faceOfHit(hit) { return this.obj.userData.buffers.triFace[hit.faceIndex]; }
  nearestVertex(cands, p, maxPx) {
    let best = -1, bd = maxPx * maxPx;
    for (const vi of cands) { const s = this.screenOf(this.pm.v[vi]); if (s.z > 1) continue; const d = (s.x - p.x) ** 2 + (s.y - p.y) ** 2; if (d < bd) { bd = d; best = vi; } }
    return best;
  }
  nearestEdgeOfFace(fi, p, maxPx) {
    const f = this.pm.f[fi]; let best = -1, bd = maxPx;
    for (let k = 0; k < f.length; k++) {
      const a = this.screenOf(this.pm.v[f[k]]), b = this.screenOf(this.pm.v[f[(k + 1) % f.length]]);
      const d = segDist(p, a, b);
      if (d < bd) { bd = d; best = this.edges.index.get(edgeKey(f[k], f[(k + 1) % f.length])) ?? -1; }
    }
    return best;
  }
  // 클릭으로 고르기. add=Shift(토글), 돌려주는 값: 무언가 처리했는지
  pick(e, add = false) {
    const h = this.hit(e), p = this.ptr(e);
    let kind = this.mode, idx = -1;
    if (kind === 'face') { if (h) idx = this.faceOfHit(h); }
    else if (kind === 'vert') { idx = this.nearestVertex(h ? this.pm.f[this.faceOfHit(h)] : this.pm.v.map((_, i) => i), p, h ? 40 : 14); }
    else if (h) idx = this.nearestEdgeOfFace(this.faceOfHit(h), p, 24);
    const set = { vert: this.sel.verts, edge: this.sel.edges, face: this.sel.faces }[kind];
    if (idx < 0) { if (!add) this.clearSel(); return !!h; }
    if (add) { set.has(idx) ? set.delete(idx) : set.add(idx); }
    else { set.clear(); set.add(idx); }
    this.refreshSel(); this.afterSelect();
    return true;
  }
  // Alt+클릭: 선 모드에서 한 바퀴(엣지 루프) 선택
  pickLoop(e, add) {
    if (this.mode !== 'edge') return this.pick(e, add);
    const h = this.hit(e); if (!h) return false;
    const ei = this.nearestEdgeOfFace(this.faceOfHit(h), this.ptr(e), 30);
    if (ei < 0) return false;
    if (!add) this.sel.edges.clear();
    for (const k of edgeLoop(this.pm, this.edges, ei)) this.sel.edges.add(k);
    this.refreshSel(); this.afterSelect();
    return true;
  }
  // 네모 치기(화면 좌표, canvas 기준 px)
  boxSelect(x0, y0, x1, y1, add) {
    const inside = s => s.z <= 1 && s.x >= Math.min(x0, x1) && s.x <= Math.max(x0, x1) && s.y >= Math.min(y0, y1) && s.y <= Math.max(y0, y1);
    const pm = this.pm;
    const vin = pm.v.map(v => inside(this.screenOf(v)));
    if (!add) this.clearSel(false);
    if (this.mode === 'vert') vin.forEach((ok, i) => ok && this.sel.verts.add(i));
    else if (this.mode === 'edge') this.edges.list.forEach((e, i) => { if (vin[e.a] && vin[e.b]) this.sel.edges.add(i); });
    else pm.f.forEach((f, i) => { if (inside(this.screenOf(faceCenter(pm, i)))) this.sel.faces.add(i); });
    this.refreshSel(); this.afterSelect();
  }
  selectionCenterWorld() {
    const idx = this.selectedVertexIndices(); if (!idx.length) return null;
    const c = new THREE.Vector3();
    for (const i of idx) c.add(new THREE.Vector3(...this.pm.v[i]));
    return c.multiplyScalar(1 / idx.length).applyMatrix4(this.obj.matrixWorld);
  }

  // ── 고른 것 옮기기/돌리기/키우기 (편집기의 기즈모가 호출) ──
  beginTransform() { this.tIdx = this.selectedVertexIndices(); this.tStart = this.tIdx.map(i => this.pm.v[i].slice()); }
  applyWorldDelta(delta) {
    if (!this.tStart) return;
    const inv = this.obj.matrixWorld.clone().invert();
    const local = inv.multiply(delta).multiply(this.obj.matrixWorld);
    const v = new THREE.Vector3();
    this.tIdx.forEach((i, k) => { v.set(...this.tStart[k]).applyMatrix4(local); this.pm.v[i] = [v.x, v.y, v.z]; });
    this.markMesh();
    this.updatePositions();
  }
  endTransform() { if (!this.tStart) return; this.tStart = null; this.E.commit(); }

  // ── 값을 조절하며 미리 보는 작업(베벨·밀어내기·루프 자르기·인셋) ──
  // 블렌더처럼: 시작한 뒤 마우스를 움직이면 값(거리·두께·폭)이 따라오고, 왼쪽 클릭으로 확정, 오른쪽 클릭·Esc 로 취소. 아래 줄 슬라이더를 만지면 마우스 따라가기는 멈춘다.
  beginOp(kind, opts = {}) {
    if (this.op) this.cancelOp();
    const base = clonePolyMesh(this.pm);
    const op = { kind, base, baseE: null, params: { ...OP_DEFAULTS[kind] }, mode: this.mode, sel: { verts: new Set(this.sel.verts), edges: new Set(this.sel.edges), faces: new Set(this.sel.faces) }, kind0: this.obj.userData.kind, paint0: snapshotTex(this.obj, base) };
    if (kind === 'bevel') {
      op.edgeIds = edgesOfSelection(base, (op.baseE = pmEdges(base)), { mode: this.mode, verts: [...this.sel.verts], edges: [...this.sel.edges], faces: [...this.sel.faces] });
      if (!op.edgeIds.length) { this.E.message(t('베벨할 선(또는 점·면)을 먼저 고르세요')); return false; }
      // 도형 크기에 맞춰 기본 폭
      const b = this.obj.geometry.boundingBox; const sz = b ? Math.max(1e-3, b.getSize(new THREE.Vector3()).length()) : 1;
      op.params.width = +Math.min(OP_RANGE.width[1], Math.max(OP_RANGE.width[0], sz * 0.05)).toFixed(3);
    } else if (kind === 'extrude') {
      op.faces = [...(this.mode === 'face' ? this.sel.faces : this.facesTouching())];
      if (!op.faces.length) { this.E.message(t('밀어낼 면을 먼저 고르세요')); return false; }
    } else if (kind === 'inset') {
      op.faces = [...(this.mode === 'face' ? this.sel.faces : this.facesTouching())];
      if (!op.faces.length) { this.E.message(t('인셋할 면을 먼저 고르세요 (3 키: 면 고르기)')); return false; }
      op.params.individual = !!opts.individual;   // 기본은 이어진 면을 한 덩어리로
      const b = this.obj.geometry.boundingBox; const sz = b ? Math.max(1e-3, b.getSize(new THREE.Vector3()).length()) : 1;
      op.params.thickness = +Math.min(OP_RANGE.thickness[1], Math.max(OP_RANGE.thickness[0], sz * 0.06)).toFixed(3);
    } else if (kind === 'loopcut') {
      op.phase = 'hover'; op.ring = null; op.hoverEdge = -1;
      this.E.message(t('도형의 모서리에 마우스를 올리면 자를 자리가 노랗게 보여요. 휠로 개수, 클릭으로 자르기'));
    }
    this.op = op;
    if (kind !== 'loopcut') { this.setupFollow(op); this.computeOp(); }
    this.changed();
    return true;
  }
  // 마우스 따라가기 준비: 선택 중심의 화면 좌표, 1 단위가 몇 px 인지, (밀어내기) 법선의 화면 방향
  setupFollow(op) {
    const key = { bevel: 'width', extrude: 'dist', inset: 'thickness' }[op.kind];
    if (!key) return;
    const center = this.selectionCenterWorld() || this.obj.getWorldPosition(new THREE.Vector3());
    const cam = this.E.camera, r = this.E.canvas.getBoundingClientRect();
    const toPx = v => { const p = v.clone().project(cam); return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height }; };
    const c = toPx(center);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    const unit = toPx(center.clone().add(right));
    const pxPerUnit = Math.max(20, Math.hypot(unit.x - c.x, unit.y - c.y));
    let dir = null;
    if (op.kind === 'extrude') {
      const n = new THREE.Vector3();
      for (const fi of op.faces) { const fn = pmFaceNormalV(op.base, fi); n.add(fn); }
      n.normalize().transformDirection(this.obj.matrixWorld);
      const tip = toPx(center.clone().add(n));
      const dx = tip.x - c.x, dy = tip.y - c.y, l = Math.hypot(dx, dy);
      dir = l > 4 ? { x: dx / l, y: dy / l } : { x: 0, y: -1 };
    }
    op.follow = { key, x0: null, y0: null, base: op.params[key], center: c, pxPerUnit, dir };
  }
  // 캔버스 위에서 마우스가 움직일 때(편집기가 호출). 따라가는 중이면 true
  opMouseMove(e) {
    const op = this.op, f = op?.follow; if (!f) return false;
    if (f.x0 === null) { f.x0 = e.clientX; f.y0 = e.clientY; return true; }
    const dx = e.clientX - f.x0, dy = e.clientY - f.y0;
    let v;
    if (op.kind === 'extrude') v = f.base + (dx * f.dir.x + dy * f.dir.y) / f.pxPerUnit;
    else if (op.kind === 'inset') {   // 선택 중심 쪽으로 움직이면 두꺼워진다
      const cx = f.center.x - f.x0, cy = f.center.y - f.y0, cl = Math.hypot(cx, cy) || 1;
      v = f.base + (dx * cx + dy * cy) / cl / f.pxPerUnit;
    } else {   // 베벨: 중심에서 멀어질수록 넓어진다
      const d0 = Math.hypot(f.x0 - f.center.x, f.y0 - f.center.y), d1 = Math.hypot(e.clientX - f.center.x, e.clientY - f.center.y);
      v = f.base + (d1 - d0) / f.pxPerUnit;
    }
    if (this.E.snap) v = Math.round(v / 0.05) * 0.05;
    if (!this.followRaf) this.followRaf = requestAnimationFrame(() => { this.followRaf = 0; if (this.op === op && op.follow) this.setOpParams({ [f.key]: v }, 'mouse'); });
    this.pendingFollow = v;
    return true;
  }
  setOpParams(patch, source = 'ui') {
    if (!this.op) return;
    if (source !== 'mouse' && this.op.follow) this.op.follow = null;   // 슬라이더를 만지면 마우스 따라가기는 끝
    for (const [k, v] of Object.entries(patch)) { const r = OP_RANGE[k]; this.op.params[k] = r ? Math.min(r[1], Math.max(r[0], Number(v))) : v; }
    if (this.op.kind === 'loopcut') { if (this.op.phase === 'hover') this.previewLoopCut(); else this.applySlide(); }
    else this.computeOp();
    this.changed();
  }
  // 작업 중 키: 인셋에서 Ctrl+I 는 '면마다 따로' 토글(블렌더의 I)
  toggleIndividual() { if (this.op?.kind === 'inset') this.setOpParams({ individual: !this.op.params.individual }, 'mouse'); }
  computeOp() {
    const op = this.op; if (!op) return;
    let res;
    try {
      if (op.kind === 'bevel') res = bevelEdges(op.base, op.baseE, op.edgeIds, { width: op.params.width, segments: Math.round(op.params.segments) });
      else if (op.kind === 'extrude') res = extrudeFaces(op.base, op.faces, op.params.dist);
      else if (op.kind === 'inset') res = insetFaces(op.base, op.faces, { thickness: op.params.thickness, depth: op.params.depth, individual: !!op.params.individual });
    } catch (e) { console.warn('op failed', e); this.E.message(t('이 모양에는 적용할 수 없어요')); return; }
    if (!res?.pm) return;
    this.markMesh();
    replacePolyMesh(this.obj, res.pm, { faceOrigin: res.faceOrigin, basePaint: op.paint0 });
    this.rebuild();
    this.mode = 'face';
    for (const fi of res.faces || []) this.sel.faces.add(fi);
    this.refreshSel(); this.E.updatePivot();
  }
  confirmOp() {
    const op = this.op; if (!op) return;
    if (op.kind === 'loopcut' && op.phase === 'hover') { this.cancelOp(); return; }
    this.op = null;
    this.setHoverLines([]);
    this.E.commit();
    this.changed();
  }
  cancelOp() {
    const op = this.op; if (!op) return;
    this.op = null;
    this.setHoverLines([]);
    if (op.kind !== 'loopcut' || op.phase !== 'hover') {
      replacePolyMesh(this.obj, op.base, { basePaint: op.paint0 }); this.rebuild();
      this.mode = op.mode; this.sel = { verts: new Set(op.sel.verts), edges: new Set(op.sel.edges), faces: new Set(op.sel.faces) };
      this.obj.userData.kind = op.kind0;
      this.refreshSel();
    }
    this.E.updatePivot();
    this.changed();
  }
  facesTouching() {
    const s = new Set(), pm = this.pm;
    if (this.mode === 'face') return new Set(this.sel.faces);
    const vs = this.selectedVertexSet();
    pm.f.forEach((f, i) => { if (f.some(vi => vs.has(vi))) s.add(i); });
    return s;
  }
  deleteSelected() {
    const faces = [...this.facesTouching()];
    if (!faces.length) return false;
    if (faces.length >= this.pm.f.length) return 'all';
    const { pm, faceOrigin } = deleteFaces(this.pm, faces);
    this.markMesh();
    replacePolyMesh(this.obj, pm, { faceOrigin });
    this.rebuild();
    this.E.commit();
    this.changed();
    return true;
  }

  // ── 루프 자르기: 마우스를 올리면 미리보기, 클릭하면 자르고, 끌어서 위치를 정한 뒤 다시 클릭 ──
  hoverMove(e) {
    const op = this.op; if (!op || op.kind !== 'loopcut') return false;
    if (op.phase === 'hover') {
      const h = this.hit(e);
      const ei = h ? this.nearestEdgeOfFace(this.faceOfHit(h), this.ptr(e), 1e9) : -1;
      if (ei !== op.hoverEdge) { op.hoverEdge = ei; op.ring = ei >= 0 ? edgeRing(this.pm, this.edges, ei) : null; this.previewLoopCut(); }
      return true;
    }
    if (op.phase === 'slide') {
      const dx = e.clientX - op.slideX;
      this.setOpParams({ slide: dx / 160 });
      return true;
    }
    return false;
  }
  cutParams() {
    const { cuts, slide } = this.op.params, n = Math.round(cuts), out = [];
    for (let k = 0; k < n; k++) { let t = (k + 1) / (n + 1); t = slide > 0 ? t + slide * (1 - t) : t + slide * t; out.push(t); }
    return out;
  }
  previewLoopCut() {
    const op = this.op; if (!op?.ring) return this.setHoverLines([]);
    const pm = this.pm, lines = [];
    for (const t of this.cutParams()) {
      const pts = op.ring.edges.map(({ a, b }) => lerp3(pm.v[a], pm.v[b], t));
      for (let i = 0; i + 1 < pts.length; i++) lines.push(pts[i], pts[i + 1]);
      if (op.ring.closed && pts.length > 2) lines.push(pts[pts.length - 1], pts[0]);
    }
    this.setHoverLines(lines);
  }
  loopCutClick(e) {
    const op = this.op; if (!op || op.kind !== 'loopcut') return false;
    if (op.phase === 'hover') {
      if (!op.ring) return true;
      let res;
      try { res = loopCut(op.base, op.ring, Math.round(op.params.cuts), 0); } catch (err) { console.warn(err); this.E.message(t('여기는 자를 수 없어요')); return true; }
      this.markMesh();
      replacePolyMesh(this.obj, res.pm, { faceOrigin: res.faceOrigin, basePaint: op.paint0 });
      this.rebuild();
      this.mode = 'edge';
      for (const [a, b] of res.edges) { const ei = this.edges.index.get(edgeKey(a, b)); if (ei !== undefined) this.sel.edges.add(ei); }
      op.newVerts = res.verts; op.phase = 'slide'; op.slideX = e.clientX; op.params.slide = 0;
      this.setHoverLines([]);
      this.refreshSel(); this.E.updatePivot();
      this.E.message(t('좌우로 움직여 자를 위치를 정하고, 클릭해서 확정하세요'));
      this.changed();
      return true;
    }
    this.confirmOp();
    return true;
  }
  applySlide() {
    const op = this.op; if (!op?.newVerts) return;
    const pm = this.pm, ts = this.cutParams();
    op.newVerts.forEach((row, k) => row.forEach((vi, j) => { const { a, b } = op.ring.edges[j]; pm.v[vi] = lerp3(pm.v[a], pm.v[b], ts[k]); }));
    this.updatePositions();
  }
  wheel(e) {
    const op = this.op;
    if (!op) return false;
    if (op.kind === 'loopcut') { if (op.phase !== 'hover') return false; this.setOpParams({ cuts: Math.round(op.params.cuts) + (e.deltaY < 0 ? 1 : -1) }); return true; }
    if (op.kind === 'bevel') { this.setOpParams({ segments: Math.round(op.params.segments) + (e.deltaY < 0 ? 1 : -1) }, 'mouse'); return true; }   // 블렌더: 휠로 둥글기 단계
    return false;
  }
}

function pmFaceNormalV(pm, fi) {
  const f = pm.f[fi], v = pm.v; let nx = 0, ny = 0, nz = 0;
  for (let k = 0; k < f.length; k++) { const p = v[f[k]], q = v[f[(k + 1) % f.length]]; nx += (p[1] - q[1]) * (p[2] + q[2]); ny += (p[2] - q[2]) * (p[0] + q[0]); nz += (p[0] - q[0]) * (p[1] + q[1]); }
  return new THREE.Vector3(nx, ny, nz);
}
function faceCenter(pm, fi) { const f = pm.f[fi], c = [0, 0, 0]; for (const vi of f) { c[0] += pm.v[vi][0]; c[1] += pm.v[vi][1]; c[2] += pm.v[vi][2]; } return c.map(x => x / f.length); }
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
function segDist(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}
