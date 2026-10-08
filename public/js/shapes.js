// 기본 도형 목록(이름·설명)과 다각형 메시 → Three.js 지오메트리 변환. 도형 자체는 shared/primitives.js 가 만든다.
import * as THREE from 'three';
import { makePrimitive, PRIMITIVE_KINDS } from '../shared/primitives.js';
import { pmRenderBuffers } from '../shared/polymesh.js';

export const PRIMITIVES = [
  { kind: 'box', name: '상자', help: '네모난 덩어리. 벽, 몸통, 건물에' },
  { kind: 'sphere', name: '공', help: '둥근 공. 머리, 열매, 눈알에' },
  { kind: 'cylinder', name: '원기둥', help: '캔 모양. 다리, 기둥, 바퀴에' },
  { kind: 'cone', name: '원뿔', help: '뾰족한 고깔. 지붕, 코, 나무에' },
  { kind: 'torus', name: '도넛', help: '고리. 반지, 타이어, 손잡이에' },
  { kind: 'capsule', name: '캡슐', help: '알약 모양. 팔다리, 몸통에' },
  { kind: 'slab', name: '판', help: '얇은 판. 바닥, 책상, 날개에' },
  { kind: 'pyramid', name: '피라미드', help: '네모 뿔. 지붕, 산에' },
  { kind: 'hemisphere', name: '반구', help: '공을 반으로 자른 돔. 모자, 그릇에' },
  { kind: 'prism3', name: '세모 기둥', help: '삼각형 기둥. 지붕, 쐐기에' },
  { kind: 'prism6', name: '육각 기둥', help: '육각형 기둥. 연필, 너트에' },
  { kind: 'star', name: '별', help: '두툼한 별' },
  { kind: 'heart', name: '하트', help: '두툼한 하트' },
  { kind: 'clay', name: '찰흙 덩어리', help: '찰흙 도구로 주무르기 좋은 부드러운 덩어리' },
];
const BY_KIND = new Map(PRIMITIVES.map(p => [p.kind, p]));
export const primitiveDef = kind => BY_KIND.get(kind);

export function makePrimitivePoly(kind, hd = false) {
  return makePrimitive(PRIMITIVE_KINDS.includes(kind) ? kind : 'box', hd);
}

// 다각형 메시 → 인덱스 없는 BufferGeometry. buffers 를 같이 돌려주므로 정점이 움직이면 syncGeometry 로 갱신한다.
export function geometryFromPolyMesh(pm) {
  const buffers = pmRenderBuffers(pm);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(buffers.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(buffers.normal, 3));
  g.computeBoundingBox(); g.computeBoundingSphere();
  return { geometry: g, buffers };
}
// 같은 위상에서 정점 위치만 바뀐 뒤(찰흙·점 이동) 호출
export function syncGeometry(obj) {
  const { pm, buffers } = obj.userData;
  buffers.update(pm);
  const g = obj.geometry;
  g.attributes.position.needsUpdate = true; g.attributes.normal.needsUpdate = true;
  g.computeBoundingBox(); g.computeBoundingSphere();
}
// 위상이 바뀐 뒤(베벨·루프 자르기·삭제): 지오메트리를 새로 만든다
export function replacePolyMesh(obj, pm) {
  const { geometry, buffers } = geometryFromPolyMesh(pm);
  obj.geometry.dispose();
  obj.geometry = geometry;
  obj.userData.pm = pm; obj.userData.buffers = buffers;
}

export function makePrimitiveGeometry(kind, hd = false) {
  return geometryFromPolyMesh(makePrimitivePoly(kind, hd)).geometry;
}
