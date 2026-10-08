// 편집기 카메라: 조작 모드(schemes.js)에 따라 돌리기·옮기기·확대 제스처가 다르다. 터치는 한 손가락 돌리기, 두 손가락 옮기기·확대.
import * as THREE from 'three';
import { matchGesture } from './schemes.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export class CameraRig {
  constructor(camera, dom) {
    this.camera = camera; this.dom = dom;
    this.target = new THREE.Vector3(0, 0.8, 0);
    this.sph = new THREE.Spherical().setFromVector3(camera.position.clone().sub(this.target));
    this.goal = { theta: this.sph.theta, phi: this.sph.phi, r: this.sph.radius, target: this.target.clone() };
    this.minR = 0.8; this.maxR = 90; this.minPhi = 0.04; this.maxPhi = Math.PI / 2 - 0.01;
    this.damping = 0.18; this.enabled = true;
    this.scheme = null; this.drag = null;         // { kind, x, y }
    this.touches = new Map();                     // pointerId → {x,y}
    this.pinch = null;
    this.onWheel = e => this.wheel(e);
    dom.addEventListener('wheel', this.onWheel, { passive: false });
  }
  setScheme(s) { this.scheme = s; }

  // 포인터가 눌렸을 때: 제스처에 맞으면 드래그를 시작하고 종류를 돌려준다(아니면 null)
  begin(e, { overObject = false } = {}) {
    if (!this.enabled) return null;
    if (e.pointerType === 'touch') {
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.touches.size === 2) { const [a, b] = [...this.touches.values()]; this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 }; this.drag = { kind: 'touch2' }; return 'pan'; }
      if (overObject) return null;
      this.drag = { kind: 'orbit', x: e.clientX, y: e.clientY, touch: true };
      return 'orbit';
    }
    const cam = this.scheme?.camera || {};
    const order = [['orbit', cam.orbit], ['orbit', cam.orbit2], ['pan', cam.pan], ['pan', cam.pan2], ['zoom', cam.zoomDrag]];
    for (const [kind, g] of order) {
      if (!g || !matchGesture(g, e)) continue;
      if (g.emptyOnly && overObject) continue;
      this.drag = { kind, x: e.clientX, y: e.clientY };
      return kind;
    }
    return null;
  }
  move(e) {
    if (!this.drag) return false;
    if (e.pointerType === 'touch') {
      const t = this.touches.get(e.pointerId); if (t) { t.x = e.clientX; t.y = e.clientY; }
      if (this.drag.kind === 'touch2' && this.touches.size === 2) {
        const [a, b] = [...this.touches.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
        if (this.pinch) { this.dolly(this.pinch.d / Math.max(1, d)); this.panBy(cx - this.pinch.cx, cy - this.pinch.cy); }
        this.pinch = { d, cx, cy };
        return true;
      }
    }
    const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
    this.drag.x = e.clientX; this.drag.y = e.clientY;
    const h = this.dom.clientHeight || 400;
    if (this.drag.kind === 'orbit') { this.goal.theta -= (2 * Math.PI * dx) / h; this.goal.phi = clamp(this.goal.phi - (2 * Math.PI * dy) / h, this.minPhi, this.maxPhi); }
    else if (this.drag.kind === 'pan') this.panBy(dx, dy);
    else if (this.drag.kind === 'zoom') this.dolly(Math.exp(dy * 0.005));
    return true;
  }
  end(e) {
    if (e?.pointerType === 'touch') { this.touches.delete(e.pointerId); if (this.touches.size < 2) this.pinch = null; if (this.touches.size === 0) this.drag = null; else if (this.touches.size === 1) { const [t] = this.touches.values(); this.drag = { kind: 'orbit', x: t.x, y: t.y, touch: true }; } return; }
    this.drag = null;
  }
  get dragging() { return !!this.drag; }
  cancel() { this.drag = null; this.touches.clear(); this.pinch = null; }

  wheel(e) {
    if (!this.enabled) return;
    e.preventDefault();
    if (this.onWheelHook?.(e)) return;             // 루프 자르기 개수 등이 휠을 가로챌 수 있다
    const k = e.deltaMode === 1 ? 0.05 : e.deltaMode === 2 ? 0.5 : 0.0012;
    this.dolly(Math.exp(e.deltaY * k * (e.shiftKey ? 0.25 : 1)));
  }
  dolly(f) { this.goal.r = clamp(this.goal.r * f, this.minR, this.maxR); }
  panBy(dx, dy) {
    const h = this.dom.clientHeight || 400;
    const dist = this.goal.r * 2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 1);
    this.goal.target.addScaledVector(right, (-dx / h) * dist).addScaledVector(up, (dy / h) * dist);
    this.goal.target.y = Math.max(-2, this.goal.target.y);
  }
  // 매 프레임: 목표값으로 부드럽게
  update() {
    const g = this.goal, k = this.damping;
    this.sph.theta += (g.theta - this.sph.theta) * k; this.sph.phi += (g.phi - this.sph.phi) * k; this.sph.radius += (g.r - this.sph.radius) * k;
    this.target.lerp(g.target, k);
    this.camera.position.setFromSpherical(this.sph).add(this.target);
    this.camera.lookAt(this.target);
  }
  // 즉시 이동(시점 버튼·맞추기)
  jumpTo(position, target) {
    this.target.copy(target); this.goal.target.copy(target);
    this.sph.setFromVector3(position.clone().sub(target));
    this.sph.phi = clamp(this.sph.phi, this.minPhi, this.maxPhi);
    Object.assign(this.goal, { theta: this.sph.theta, phi: this.sph.phi, r: clamp(this.sph.radius, this.minR, this.maxR) });
    this.update();
  }
  fitBox(box, pad = 1.25) {
    const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(size.length() / 2, 1.2) * pad;
    const dist = radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov) / 2);
    const dir = this.camera.position.clone().sub(this.target).normalize();
    if (dir.lengthSq() < 1e-6) dir.set(0.7, 0.55, 1).normalize();
    this.jumpTo(center.clone().addScaledVector(dir, dist), center);
  }
  setView(name, box) {
    const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
    const d = Math.max(3, size.length() * 1.3);
    const pos = { front: [0, 0.35, 1], side: [1, 0.35, 0], top: [0, 1, 0.001], iso: [0.7, 0.55, 0.7] }[name] || [0.7, 0.55, 0.7];
    this.jumpTo(c.clone().add(new THREE.Vector3(...pos).normalize().multiplyScalar(d)), c);
  }
  dispose() { this.dom.removeEventListener('wheel', this.onWheel); }
}
