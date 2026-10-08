// 기본 도형 목록(이름·설명)과 다각형 메시 → Three.js 지오메트리 변환. 도형 자체는 shared/primitives.js 가 만든다.
import * as THREE from 'three';
import { makePrimitive, PRIMITIVE_KINDS } from '../shared/primitives.js';
import { pmRenderBuffers } from '../shared/polymesh.js';
import { snapshotTex, rebakeTex, refreshCharts, attachMap, disposeTex, ensureTex } from './texpaint.js';
import { t } from '../shared/i18n.js';

export const PRIMITIVES = [
  { kind: 'box', name: t('상자'), help: t('네모난 덩어리. 벽, 몸통, 건물에') },
  { kind: 'sphere', name: t('공'), help: t('둥근 공. 머리, 열매, 눈알에') },
  { kind: 'cylinder', name: t('원기둥'), help: t('캔 모양. 다리, 기둥, 바퀴에') },
  { kind: 'cone', name: t('원뿔'), help: t('뾰족한 고깔. 지붕, 코, 나무에') },
  { kind: 'torus', name: t('도넛'), help: t('고리. 반지, 타이어, 손잡이에') },
  { kind: 'capsule', name: t('캡슐'), help: t('알약 모양. 팔다리, 몸통에') },
  { kind: 'slab', name: t('판'), help: t('얇은 판. 바닥, 책상, 날개에') },
  { kind: 'pyramid', name: t('피라미드'), help: t('네모 뿔. 지붕, 산에') },
  { kind: 'hemisphere', name: t('반구'), help: t('공을 반으로 자른 돔. 모자, 그릇에') },
  { kind: 'prism3', name: t('세모 기둥'), help: t('삼각형 기둥. 지붕, 쐐기에') },
  { kind: 'prism6', name: t('육각 기둥'), help: t('육각형 기둥. 연필, 너트에') },
  { kind: 'star', name: t('별'), help: t('두툼한 별') },
  { kind: 'heart', name: t('하트'), help: t('두툼한 하트') },
  { kind: 'clay', name: t('찰흙 덩어리'), help: t('찰흙 도구로 주무르기 좋은 부드러운 덩어리') },
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
// 같은 위상에서 정점 위치만 바뀐 뒤(찰흙·점 이동) 호출. 페인트 그림이 있으면 UV 도 따라간다
export function syncGeometry(obj) {
  const { pm, buffers } = obj.userData;
  buffers.update(pm);
  const g = obj.geometry;
  g.attributes.position.needsUpdate = true; g.attributes.normal.needsUpdate = true;
  g.computeBoundingBox(); g.computeBoundingSphere();
  if (obj.userData.tex) refreshCharts(obj);
}
// 페인트 그림(userData.tex)을 재질에 붙인다/뗀다
export function syncPaint(obj) { if (obj?.isMesh) attachMap(obj); }
// 위상이 바뀐 뒤(베벨·루프 자르기·인셋·삭제·찰흙용 변환·좌우 뒤집기): 지오메트리를 새로 만들고 페인트 그림을 새 면에 맞춰 다시 굽는다.
// faceOrigin(새 면 → 원래 면)이 있으면 그걸로, 없는데 면 수가 달라지면 가장 가까운 면에서. basePaint 는 작업 시작 시점의 스냅샷(snapshotTex, 미리보기 재계산용;
// null 이면 그때 그림이 없었다는 뜻). pointMap 은 새 좌표 → 원래 좌표(좌우 뒤집기).
export function replacePolyMesh(obj, pm, { faceOrigin = null, basePaint, pointMap = null } = {}) {
  const u = obj.userData;
  const base = basePaint !== undefined ? basePaint : snapshotTex(obj);
  const { geometry, buffers } = geometryFromPolyMesh(pm);
  obj.geometry.dispose();
  obj.geometry = geometry;
  u.pm = pm; u.buffers = buffers;
  if (base) { ensureTex(obj, base.layout); rebakeTex(obj, { faceOrigin, base, pointMap }); }
  else if (u.tex) disposeTex(obj);
  syncPaint(obj);
}

export function makePrimitiveGeometry(kind, hd = false) {
  return geometryFromPolyMesh(makePrimitivePoly(kind, hd)).geometry;
}
