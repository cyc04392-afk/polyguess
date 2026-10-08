// 작품을 OBJ(+MTL zip) / FBX 파일로 내려받는 버튼. 앨범·다같이 맞추기·체험판 미리보기에서 같이 쓴다.
import { toOBJ, toFBX, makeZip } from '../shared/export3d.js';
import { t as tr } from '../shared/i18n.js';

const DL_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M4 19h16"/></svg>';
export const exportName = (tag = 'model') => { const d = new Date(), z = n => String(n).padStart(2, '0'); return `polyguess-${tag}-${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`; };

export function saveBlob(blob, name) {
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = href; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10000);
}
export function downloadOBJ(scene, name) {
  const { obj, mtl } = toOBJ(scene, name);
  saveBlob(new Blob([makeZip([{ name: `${name}.obj`, data: obj }, { name: `${name}.mtl`, data: mtl }])], { type: 'application/zip' }), `${name}.zip`);
}
export function downloadFBX(scene, name) { saveBlob(new Blob([toFBX(scene, name)], { type: 'application/octet-stream' }), `${name}.fbx`); }

// getScene(): 지금 내보낼 작품 JSON(없으면 null). onDone(fmt): 저장 뒤 안내(토스트)
export function exportButtons(getScene, tag, onDone) {
  const mk = (fmt, title, run) => {
    const b = document.createElement('button');
    b.className = 'dl-btn'; b.type = 'button'; b.title = title; b.setAttribute('aria-label', title); b.dataset.fmt = fmt;
    b.innerHTML = `${DL_ICON}<span>${fmt}</span>`;
    b.onclick = () => {
      const scene = getScene();
      if (!scene || !(scene.objects || []).some(o => o.kind !== 'light')) return onDone?.(null);
      try { run(scene, exportName(tag)); onDone?.(fmt); } catch (e) { console.error('export failed', e); onDone?.(null); }
    };
    return b;
  };
  return [
    mk('FBX', tr('FBX 파일로 저장 (블렌더·마야·유니티에서 바로 열려요)'), downloadFBX),
    mk('OBJ', tr('OBJ 파일로 저장 (색·재질 .mtl 과 함께 zip 으로. 블렌더·마야·유니티에서 열려요)'), downloadOBJ),
  ];
}
