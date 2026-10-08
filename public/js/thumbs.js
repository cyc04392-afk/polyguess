// 도형·재질 버튼에 쓸 작은 3D 그림을 실제 지오메트리로 렌더링한다(이모지 대신).
import * as THREE from 'three';
import { PRIMITIVES, makePrimitiveGeometry } from './shapes.js';
import { FINISHES, makeMaterial } from './sceneio.js';

export function renderThumbs({ size = 96, color = '#e9e6f6', finishColor = '#9775fa' } = {}) {
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1); renderer.setSize(size, size); renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8f8fb0, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(3, 5, 4); scene.add(sun);
  const fill = new THREE.DirectionalLight(0xffffff, 0.5); fill.position.set(-4, 2, -3); scene.add(fill);
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 50);
  const dir = new THREE.Vector3(1, 0.85, 1.35).normalize();
  const shapes = new Map(), finishes = new Map();
  const shoot = (geo, material, pad = 1.08) => {
    geo.computeBoundingSphere();
    const r = geo.boundingSphere.radius || 0.5, c = geo.boundingSphere.center;
    const mesh = new THREE.Mesh(geo, material); scene.add(mesh);
    const dist = (r * pad) / Math.sin(THREE.MathUtils.degToRad(camera.fov) / 2);
    camera.position.copy(c).addScaledVector(dir, dist); camera.lookAt(c);
    renderer.render(scene, camera);
    const url = renderer.domElement.toDataURL('image/png');
    scene.remove(mesh); geo.dispose(); material.dispose();
    return url;
  };
  for (const p of PRIMITIVES) shapes.set(p.kind, shoot(makePrimitiveGeometry(p.kind, false), new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05 })));
  for (const f of FINISHES) finishes.set(f.key, shoot(new THREE.SphereGeometry(0.5, 48, 32), makeMaterial({ c: finishColor, f: f.key }), 1.12));
  renderer.dispose(); renderer.forceContextLoss?.();
  return { shapes, finishes };
}
