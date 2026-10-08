// 장면 JSON ↔ Three.js 오브젝트, 공통 환경(배경·바닥·조명), 재질 프리셋.
import * as THREE from 'three';
import { makePrimitivePoly, geometryFromPolyMesh, syncPaint } from './shapes.js';
import { paintFromJSON } from '../shared/paint.js';
import { loadTexFromJSON, texToJSON, bakeLegacyPaint } from './texpaint.js';
import { buildLight, setLightColor, setHelpersVisible } from './lights.js';
import { pmFromJSON, pmToJSON } from '../shared/polymesh.js';
import { PRIM_KINDS } from '../shared/scene.js';
import { t } from '../shared/i18n.js';

export const BG_PRESETS = [
  { name: t('하늘'), bg: '#bfe3ff', ground: '#e6ebf7', grid: '#c9d2ea' },
  { name: t('노을'), bg: '#ffd9b8', ground: '#f6e3d4', grid: '#e4c9b4' },
  { name: t('밤'), bg: '#1f1b3d', ground: '#3a3560', grid: '#514a80' },
  { name: t('민트'), bg: '#cdeedd', ground: '#e3f3ea', grid: '#bfdccb' },
  { name: t('분홍'), bg: '#ffd6e7', ground: '#f8e4ee', grid: '#e9c6d6' },
  { name: t('하양'), bg: '#f3f2f8', ground: '#e8e6f0', grid: '#d5d2e3' },
  { name: t('보라'), bg: '#3b2f73', ground: '#55489a', grid: '#6f62b4' },
];

// 갈틱폰처럼 3열 팔레트(18색). 위에서부터 무채색 → 따뜻한 색 → 차가운 색.
export const PALETTE = [
  '#1b1b2a', '#7a7a8c', '#f4f4f8',
  '#ff5c7a', '#e03131', '#ff8c42',
  '#ffd23f', '#ffe8cc', '#c0855a',
  '#8d6e63', '#7ed957', '#2b8a3e',
  '#20c997', '#4dabf7', '#1c7ed6',
  '#5c7cfa', '#9775fa', '#f783ac',
];

export const FINISHES = [
  { key: 'basic', name: t('기본'), help: t('보통 플라스틱 느낌') },
  { key: 'shiny', name: t('반짝'), help: t('매끈하고 반사가 있어요') },
  { key: 'metal', name: t('금속'), help: t('쇠처럼 번쩍여요') },
  { key: 'glass', name: t('유리'), help: t('반투명하게 비쳐요') },
  { key: 'glow', name: t('빛남'), help: t('스스로 빛나요') },
];

function materialProps(mat) {
  const c = new THREE.Color(mat.c);
  switch (mat.f) {
    case 'shiny': return { color: c, roughness: 0.15, metalness: 0.08, transparent: false, opacity: 1, emissive: new THREE.Color(0) };
    case 'metal': return { color: c, roughness: 0.3, metalness: 0.9, transparent: false, opacity: 1, emissive: new THREE.Color(0) };
    case 'glass': return { color: c, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.45, emissive: new THREE.Color(0) };
    case 'glow': return { color: c, roughness: 0.5, metalness: 0, transparent: false, opacity: 1, emissive: c.clone().multiplyScalar(0.75) };
    default: return { color: c, roughness: 0.65, metalness: 0.02, transparent: false, opacity: 1, emissive: new THREE.Color(0) };
  }
}

// 페인트 그림(map)은 물체 색 위에 알파로 얹는다(기본 셰이더는 색을 곱하므로 바꿔 끼운다). 그림이 없으면 USE_MAP 이 꺼져 아무 영향 없음
const PAINT_SHADER = shader => {
  shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>',
    '#ifdef USE_MAP\n\tvec4 pgPaint = texture2D( map, vMapUv );\n\tdiffuseColor.rgb = mix( diffuseColor.rgb, pgPaint.rgb, pgPaint.a );\n#endif');
};
export function makeMaterial(mat) {
  const m = new THREE.MeshStandardMaterial();
  Object.assign(m, materialProps(mat));
  m.onBeforeCompile = PAINT_SHADER;
  return m;
}

export const isLight = obj => obj?.userData?.kind === 'light';

// 오브젝트에 색·재질 적용(광원은 색만)
export function applyMaterial(obj, mat) {
  if (isLight(obj)) { setLightColor(obj, mat.c); return; }
  obj.userData.mat = { c: mat.c, f: mat.f };
  Object.assign(obj.material, materialProps(mat));
  obj.material.needsUpdate = true;
  syncPaint(obj);
}

export function buildObject(o) {
  let obj;
  if (o.kind === 'light') obj = buildLight(o);
  else {
    const pm = o.kind === 'mesh' ? pmFromJSON(o.mesh) : makePrimitivePoly(o.kind, o.kind === 'clay');
    if (!pm) throw new Error('bad mesh');
    const { geometry, buffers } = geometryFromPolyMesh(pm);
    obj = new THREE.Mesh(geometry, makeMaterial(o.mat));
    obj.userData = { id: o.id, kind: o.kind, mat: { ...o.mat }, pm, buffers, tex: null };
    obj.castShadow = true; obj.receiveShadow = true;
    if (o.tex) loadTexFromJSON(obj, o.tex);
    else if (o.paint) bakeLegacyPaint(obj, paintFromJSON(o.paint, pm.f.length));   // 옛 저장본(면마다 색)
    syncPaint(obj);
  }
  obj.position.fromArray(o.p);
  obj.quaternion.fromArray(o.q);
  if (!isLight(obj)) obj.scale.fromArray(o.s);
  return obj;
}

export function objectToJSON(obj) {
  const u = obj.userData;
  const o = { id: u.id, kind: u.kind, p: obj.position.toArray().map(r4), q: obj.quaternion.toArray().map(r5), s: isLight(obj) ? [1, 1, 1] : obj.scale.toArray().map(r4), mat: { c: u.mat.c, f: u.mat.f } };
  if (u.kind === 'mesh') o.mesh = pmToJSON(u.pm);
  if (u.kind === 'light') o.light = { ...u.light };
  else { const tex = texToJSON(obj); if (tex) o.tex = tex; }
  return o;
}
const r4 = v => Math.round(v * 1e4) / 1e4, r5 = v => Math.round(v * 1e5) / 1e5;

export function sceneToJSON(group, bg) {
  return { v: 1, bg, objects: group.children.map(objectToJSON) };
}

export function disposeObject(obj) {
  obj.traverse(c => {
    if (c.geometry) c.geometry.dispose();
    if (c.material) { Array.isArray(c.material) ? c.material.forEach(m => m.dispose()) : c.material.dispose(); }
    if (c.isLight) c.dispose?.();
  });
}

// 배경·바닥·조명. setBackground(idx) 로 바꾼다. 사용자가 광원을 넣으면 기본 햇빛은 약해진다(setUserLights).
export function createEnvironment(scene, { shadowSize = 16 } = {}) {
  const ground = new THREE.Mesh(new THREE.CircleGeometry(40, 64), new THREE.MeshStandardMaterial({ roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.001; ground.receiveShadow = true;
  scene.add(ground);
  const grid = new THREE.GridHelper(24, 24, 0xffffff, 0xffffff);
  grid.material.transparent = true; grid.material.opacity = 0.35; grid.position.y = 0.002;
  scene.add(grid);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x8f8fb0, 0.9);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(6, 10, 5); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -shadowSize, right: shadowSize, top: shadowSize, bottom: -shadowSize, near: 1, far: 40 });
  sun.shadow.bias = -0.0004;
  scene.add(sun);
  const env = { ground, grid, hemi, sun, bg: 0, userLights: 0 };
  env.setBackground = idx => {
    const p = BG_PRESETS[idx] || BG_PRESETS[0];
    env.bg = BG_PRESETS[idx] ? idx : 0;
    scene.background = new THREE.Color(p.bg);
    ground.material.color.set(p.ground);
    grid.material.color.set(p.grid);
    hemi.color.set(p.bg).lerp(new THREE.Color(0xffffff), 0.6);
    env.setUserLights(env.userLights);
  };
  env.setUserLights = n => {
    env.userLights = n;
    sun.intensity = n > 0 ? 0.25 : 1.5;
    sun.castShadow = n === 0;
    hemi.intensity = n > 0 ? 0.5 : 0.9;
  };
  env.setBackground(0);
  return env;
}

export function buildSceneInto(group, sceneJson, { helpers = true } = {}) {
  for (const c of [...group.children]) { group.remove(c); disposeObject(c); }
  const objs = [];
  for (const o of sceneJson?.objects || []) { try { const obj = buildObject(o); group.add(obj); objs.push(obj); } catch (e) { console.warn('object load failed', e); } }
  if (!helpers) setHelpersVisible(group, false);
  return objs;
}
export const countLights = group => group.children.filter(isLight).length;

export function sceneBounds(group) {
  const box = new THREE.Box3();
  if (group.children.length === 0) return box.set(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 2, 1));
  for (const c of group.children) { if (isLight(c)) box.expandByPoint(c.position); else box.expandByObject(c); }
  if (box.isEmpty()) box.set(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 2, 1));
  return box;
}

// 카메라를 장면이 다 보이게 놓는다(OrbitControls 용 — 뷰어)
export function fitCamera(camera, controls, group, pad = 1.25) {
  const box = sceneBounds(group);
  const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
  const radius = Math.max(size.length() / 2, 1.2) * pad;
  const dist = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov) / 2);
  const dir = new THREE.Vector3(0.7, 0.55, 1).normalize();
  camera.position.copy(center).addScaledVector(dir, dist);
  controls.target.copy(center);
  controls.update();
}

export { PRIM_KINDS };
