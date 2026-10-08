// 찰흙 도구: 다각형 메시(userData.pm)의 정점을 부풀리고, 누르고, 매끈하게 하고, 당기고, 납작하게 한다.
import { pmNeighbors, pmVertexNormals } from '../shared/polymesh.js';
import { syncGeometry } from './shapes.js';

export const BRUSHES = [
  { key: 'inflate', name: '부풀리기', help: '문지른 곳이 볼록 튀어나와요' },
  { key: 'deflate', name: '누르기', help: '문지른 곳이 움푹 들어가요' },
  { key: 'smooth', name: '매끈하게', help: '울퉁불퉁한 곳을 부드럽게 펴요' },
  { key: 'grab', name: '당기기', help: '잡고 끌면 그쪽으로 늘어나요' },
  { key: 'flatten', name: '납작하게', help: '문지른 곳을 평평하게 눌러요' },
];

export class Sculptor {
  constructor(mesh) {
    this.mesh = mesh;
    this.pm = mesh.userData.pm;
    this.n = this.pm.v.length;
    this.neighbors = pmNeighbors(this.pm);
    this.partner = mirrorPartners(this.pm);
    this.normals = pmVertexNormals(this.pm);
    this.brush = 'inflate'; this.radius = 0.5; this.strength = 0.5; this.symmetry = true;
    this.grab = null;
  }

  // 반지름 안의 정점과 가중치
  gather(center, radius) {
    const out = [], r2 = radius * radius, v = this.pm.v;
    for (let i = 0; i < this.n; i++) {
      const dx = v[i][0] - center.x, dy = v[i][1] - center.y, dz = v[i][2] - center.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < r2) { const t = Math.sqrt(d2) / radius; out.push([i, (1 - t * t) * (1 - t * t)]); }
    }
    return out;
  }

  begin(localPoint) {
    if (this.brush === 'grab') {
      const set = this.gather(localPoint, this.radius);
      this.grab = { set, start: set.map(([i]) => this.pm.v[i].slice()) };
    }
  }

  // 한 번의 포인터 이동. localDelta 는 당기기용(시작점 기준 이동량, 로컬 좌표)
  move(localPoint, localNormal, localDelta) {
    const v = this.pm.v, nrm = this.normals, s = this.strength;
    const disp = new Map(); // index → [dx,dy,dz]
    if (this.brush === 'grab') {
      if (!this.grab || !localDelta) return;
      this.grab.set.forEach(([i, w], k) => {
        const st = this.grab.start[k];
        disp.set(i, [st[0] + localDelta.x * w - v[i][0], st[1] + localDelta.y * w - v[i][1], st[2] + localDelta.z * w - v[i][2]]);
      });
    } else {
      const set = this.gather(localPoint, this.radius);
      const amt = this.radius * 0.06 * s;
      for (const [i, w] of set) {
        if (this.brush === 'inflate' || this.brush === 'deflate') {
          const k = (this.brush === 'inflate' ? 1 : -1) * amt * w;
          disp.set(i, [nrm[i * 3] * k, nrm[i * 3 + 1] * k, nrm[i * 3 + 2] * k]);
        } else if (this.brush === 'smooth') {
          const nb = this.neighbors[i];
          if (!nb.length) continue;
          let mx = 0, my = 0, mz = 0;
          for (const j of nb) { mx += v[j][0]; my += v[j][1]; mz += v[j][2]; }
          mx /= nb.length; my /= nb.length; mz /= nb.length;
          const k = Math.min(1, w * s * 0.6);
          disp.set(i, [(mx - v[i][0]) * k, (my - v[i][1]) * k, (mz - v[i][2]) * k]);
        } else if (this.brush === 'flatten') {
          const px = v[i][0] - localPoint.x, py = v[i][1] - localPoint.y, pz = v[i][2] - localPoint.z;
          const d = px * localNormal.x + py * localNormal.y + pz * localNormal.z;
          const k = Math.min(1, w * s * 0.7);
          disp.set(i, [-localNormal.x * d * k, -localNormal.y * d * k, -localNormal.z * d * k]);
        }
      }
    }
    // 좌우 대칭: 반대편 짝에게 거울상 이동을 준다(짝이 직접 범위에 들지 않았을 때만)
    if (this.symmetry) {
      for (const [i, d] of [...disp]) {
        const j = this.partner[i];
        if (j >= 0 && j !== i && !disp.has(j)) disp.set(j, [-d[0], d[1], d[2]]);
      }
    }
    for (const [i, d] of disp) { v[i][0] += d[0]; v[i][1] += d[1]; v[i][2] += d[2]; }
    syncGeometry(this.mesh);
    this.normals = pmVertexNormals(this.pm);
  }

  end() { this.grab = null; }
}

function mirrorPartners(pm) {
  const n = pm.v.length, map = new Map(), partner = new Int32Array(n).fill(-1);
  const key = (x, y, z) => `${Math.round(x * 500)},${Math.round(y * 500)},${Math.round(z * 500)}`;
  for (let i = 0; i < n; i++) map.set(key(pm.v[i][0], pm.v[i][1], pm.v[i][2]), i);
  for (let i = 0; i < n; i++) { const j = map.get(key(-pm.v[i][0], pm.v[i][1], pm.v[i][2])); if (j !== undefined) partner[i] = j; }
  return partner;
}
