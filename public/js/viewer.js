// 읽기 전용 3D 뷰어: 완성된 작품을 돌려 보는 용도(글 쓰기 단계, 앨범, 다같이 맞추기).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createEnvironment, buildSceneInto, fitCamera, countLights } from './sceneio.js';

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
    this.alive = true;
    const loop = () => { if (!this.alive) return; this.controls.update(); this.renderer.render(this.scene, this.camera); this.raf = requestAnimationFrame(loop); };
    this.raf = requestAnimationFrame(loop);
  }
  resize() {
    const w = this.container.clientWidth || 300, h = this.container.clientHeight || 200;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }
  load(sceneJson) {
    buildSceneInto(this.group, sceneJson, { helpers: false }); // 광원 표시용 그림은 작품에 안 보이게
    this.env.setUserLights(countLights(this.group));
    this.env.setBackground(sceneJson?.bg ?? 0);
    fitCamera(this.camera, this.controls, this.group);
    this.controls.autoRotate = true;
  }
  // 지금 보이는 화면을 그림 파일(data URL)로
  snapshot(type = 'image/jpeg', quality = 0.85) {
    this.renderer.render(this.scene, this.camera);
    return this.canvas.toDataURL(type, quality);
  }
  dispose() {
    this.alive = false;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.controls.dispose();
    buildSceneInto(this.group, null);
    this.renderer.dispose();
    this.renderer.forceContextLoss?.();
    this.canvas.remove();
  }
}
