// 읽기 전용 3D 뷰어: 완성된 작품을 돌려 보는 용도(글 쓰기 단계, 앨범, 다같이 맞추기). 타임랩스(만드는 과정) 재생도 한다.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createEnvironment, buildSceneInto, buildObject, disposeObject, fitCamera, countLights } from './sceneio.js';
import { setHelpersVisible } from './lights.js';

export class Viewer {
  constructor(container, { autoRotate = true } = {}) {
    this.container = container;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'gl';
    container.appendChild(this.canvas);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
    this.camera.position.set(6, 5, 8);
    this.env = createEnvironment(this.scene);
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.autoRotate = autoRotate; this.controls.autoRotateSpeed = 1.2;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.02;
    this.controls.minDistance = 1; this.controls.maxDistance = 80;
    this._stopAuto = () => { this.controls.autoRotate = false; };
    this.canvas.addEventListener('pointerdown', this._stopAuto);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.resize();
    this.tl = null;
    this.bar = document.createElement('div'); this.bar.className = 'tl-bar hidden'; this.bar.innerHTML = '<i></i>';
    container.appendChild(this.bar);
    this.alive = true;
    const loop = () => { if (!this.alive) return; this.controls.update(); this.renderer.render(this.scene, this.camera); this.raf = requestAnimationFrame(loop); };
    this.raf = requestAnimationFrame(loop);
  }
  // ── 타임랩스: 빈 장면에서 시작해 프레임을 차례로 적용한다. 카메라는 완성 작품(load 로 미리 맞춘 것) 그대로 ──
  playTimelapse(tl, { onEnd } = {}) {
    this.stopTimelapse();
    const frames = tl?.frames;
    if (!Array.isArray(frames) || !frames.length) return false;
    this.finalScene = this.finalScene || null;
    buildSceneInto(this.group, null);
    const n = frames.length, interval = Math.max(45, Math.min(350, 6000 / n));
    this.bar.classList.remove('hidden');
    const state = { i: 0, frames, onEnd, timer: 0 };
    this.tl = state;
    const step = () => {
      if (this.tl !== state) return;
      this.applyFrame(frames[state.i]);
      state.i++;
      this.bar.firstElementChild.style.width = `${(state.i / n) * 100}%`;
      if (state.i >= n) { this.stopTimelapse(true); onEnd?.(); }   // 끝나면 완성 작품(페인트 그림 포함)으로
    };
    step();
    if (state.i < n) state.timer = setInterval(step, interval);
    return true;
  }
  get playing() { return !!this.tl; }
  // jumpToEnd 면 완성 작품으로 바로 간다
  stopTimelapse(jumpToEnd = false) {
    const st = this.tl; if (!st) { if (jumpToEnd && this.finalScene) this.loadObjects(this.finalScene); return; }
    clearInterval(st.timer); this.tl = null;
    this.bar.classList.add('hidden'); this.bar.firstElementChild.style.width = '0%';
    if (jumpToEnd && this.finalScene) this.loadObjects(this.finalScene);
  }
  applyFrame(frame) {
    if (frame.bg !== undefined) this.env.setBackground(frame.bg);
    const g = this.group;
    const removeId = id => { for (const c of g.children.filter(o => o.userData.id === id)) { g.remove(c); disposeObject(c); } };
    if (frame.del) for (const id of frame.del) removeId(id);
    if (frame.set) for (const o of frame.set) { removeId(o.id); try { const obj = buildObject(o); setHelpersVisible(obj, false); g.add(obj); } catch (e) { console.warn('frame object failed', e); } }
    this.env.setUserLights(countLights(g));
  }
  loadObjects(sceneJson) {
    buildSceneInto(this.group, sceneJson, { helpers: false });
    this.env.setUserLights(countLights(this.group));
    this.env.setBackground(sceneJson?.bg ?? 0);
  }
  resize() {
    const w = this.container.clientWidth || 300, h = this.container.clientHeight || 200;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }
  load(sceneJson) {
    this.stopTimelapse();
    this.finalScene = sceneJson;
    this.loadObjects(sceneJson); // 광원 표시용 그림은 작품에 안 보이게
    fitCamera(this.camera, this.controls, this.group);
    this.controls.autoRotate = true;
  }
  // 지금 보이는 화면을 그림 파일(data URL)로
  snapshot(type = 'image/jpeg', quality = 0.85) {
    this.renderer.render(this.scene, this.camera);
    return this.canvas.toDataURL(type, quality);
  }
  dispose() {
    this.stopTimelapse();
    this.alive = false;
    this.bar.remove();
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.controls.dispose();
    buildSceneInto(this.group, null);
    this.renderer.dispose();
    this.renderer.forceContextLoss?.();
    this.canvas.remove();
  }
}
