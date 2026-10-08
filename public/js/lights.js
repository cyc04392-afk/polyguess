// 광원 오브젝트: 해(방향광)·전구(점광)·스포트. 장면 안의 오브젝트처럼 옮기고 돌린다. 방향은 오브젝트의 -Y 축.
import * as THREE from 'three';
import { DEFAULT_LIGHT, LIGHT_RANGE, sanitizeLight } from '../shared/scene.js';

export const LIGHT_TYPES_UI = [
  { key: 'sun', name: '해', icon: 'sun', help: '멀리서 한 방향으로 비추는 빛. 그림자가 또렷해요' },
  { key: 'point', name: '전구', icon: 'bulb', help: '한 점에서 사방으로 퍼지는 빛' },
  { key: 'spot', name: '스포트', icon: 'spot', help: '손전등처럼 한 곳만 비추는 빛. 각도를 조절할 수 있어요' },
];
const MULT = { sun: 1, point: 30, spot: 25 };     // Three.js 물리 단위 보정
const DOWN = new THREE.Vector3(0, -1, 0);
export { LIGHT_RANGE, DEFAULT_LIGHT };

export function buildLight(o) {
  const holder = new THREE.Group();
  holder.userData = { id: o.id, kind: 'light', mat: { c: o.mat?.c || '#ffd23f', f: 'basic' }, light: sanitizeLight(o.light) };
  rebuildLight(holder);
  return holder;
}

function makeVis(type, color) {
  const vis = new THREE.Group();
  vis.userData.helper = true;
  const mat = new THREE.MeshBasicMaterial({ color });
  const line = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85 });
  if (type === 'sun') {
    vis.add(new THREE.Mesh(new THREE.SphereGeometry(0.18, 20, 14), mat));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.025, 8, 32), mat); ring.rotation.x = Math.PI / 2; vis.add(ring);
    vis.add(new THREE.ArrowHelper(DOWN, new THREE.Vector3(0, -0.2, 0), 0.9, color, 0.25, 0.14));
  } else if (type === 'point') {
    vis.add(new THREE.Mesh(new THREE.SphereGeometry(0.17, 20, 14), mat));
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.14, 12), new THREE.MeshBasicMaterial({ color: 0x555566 })); base.position.y = 0.22; vis.add(base);
    const rays = new THREE.Group();
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(Math.cos(a) * 0.26, Math.sin(a) * 0.26 * 0.6, Math.sin(a) * 0.26), new THREE.Vector3(Math.cos(a) * 0.4, Math.sin(a) * 0.4 * 0.6, Math.sin(a) * 0.4)]); rays.add(new THREE.Line(g, line)); }
    vis.add(rays);
  } else {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.42, 20, 1, true), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide })); cone.rotation.x = Math.PI; cone.position.y = -0.2; vis.add(cone);
    vis.add(new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), mat));
    vis.add(new THREE.ArrowHelper(DOWN, new THREE.Vector3(0, -0.4, 0), 0.7, color, 0.2, 0.12));
  }
  vis.traverse(c => { c.userData.helper = true; });
  return vis;
}

// 종류·세기·각도가 바뀌면 안쪽 광원을 다시 만든다(위치·회전은 holder 가 갖고 있어 그대로)
export function rebuildLight(holder) {
  for (const c of [...holder.children]) { holder.remove(c); c.traverse?.(x => { x.geometry?.dispose?.(); if (x.material) (Array.isArray(x.material) ? x.material : [x.material]).forEach(m => m.dispose()); }); if (c.isLight) c.dispose?.(); }
  const { type, i, a } = holder.userData.light;
  const color = new THREE.Color(holder.userData.mat.c);
  let light;
  if (type === 'sun') {
    light = new THREE.DirectionalLight(color, i * MULT.sun);
    light.castShadow = true; light.shadow.mapSize.set(1024, 1024);
    Object.assign(light.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 0.5, far: 40 });
    light.shadow.bias = -0.0005;
  } else if (type === 'point') {
    light = new THREE.PointLight(color, i * MULT.point, 0, 2);
  } else {
    light = new THREE.SpotLight(color, i * MULT.spot, 0, THREE.MathUtils.degToRad(a), 0.35, 2);
    light.castShadow = true; light.shadow.mapSize.set(1024, 1024); light.shadow.bias = -0.0005;
    light.shadow.camera.near = 0.3; light.shadow.camera.far = 40;
  }
  holder.add(light);
  if (light.target) { light.target.position.set(0, -1, 0); holder.add(light.target); }
  const vis = makeVis(type, color.getHex());
  holder.add(vis);
  holder.userData.lightObj = light; holder.userData.vis = vis;
  return light;
}

export function setLightColor(holder, hex) {
  holder.userData.mat.c = hex;
  const c = new THREE.Color(hex);
  holder.userData.lightObj.color.copy(c);
  holder.userData.vis.traverse(o => { if (o.material?.color && !(o.parent?.isMesh && o.geometry?.type === 'CylinderGeometry')) o.material.color.copy(c); if (o.isArrowHelper) o.setColor(c); });
}
export function setLightProps(holder, patch) {
  holder.userData.light = sanitizeLight({ ...holder.userData.light, ...patch });
  rebuildLight(holder);
}

// 방향 ↔ 각도(높이 elev 0~90°, 방향 azim 0~360°). 기본은 비스듬히 아래로.
export function quaternionFromAngles(elev, azim) {
  const e = THREE.MathUtils.degToRad(elev), z = THREE.MathUtils.degToRad(azim);
  const dir = new THREE.Vector3(-Math.cos(e) * Math.sin(z), -Math.sin(e), -Math.cos(e) * Math.cos(z)).normalize();
  return new THREE.Quaternion().setFromUnitVectors(DOWN, dir);
}
export function anglesFromQuaternion(q) {
  const d = DOWN.clone().applyQuaternion(q);
  const elev = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(-d.y, -1, 1)));
  let azim = THREE.MathUtils.radToDeg(Math.atan2(-d.x, -d.z)); if (azim < 0) azim += 360;
  return { elev: Math.round(elev), azim: Math.round(azim) % 360 };
}
export const defaultLightQuaternion = () => quaternionFromAngles(55, 35);

export function setHelpersVisible(root, visible) { root.traverse(o => { if (o.userData?.helper) o.visible = visible; }); }
