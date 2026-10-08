// 서버 없이 3D 만들기 도구만 체험하는 페이지(demo.html). 게임 화면과 같은 도구 UI(editorui.js)를 쓴다.
import { mountEditor, resetEditor, getEditor } from './editorui.js';
import { Viewer } from './viewer.js';
import { ICONS } from './icons.js';
import { PROMPT_SUGGESTIONS, pickRandom } from '../shared/rules.js';
import { emptyScene, sanitizeScene } from '../shared/scene.js';

document.body.dataset.phase = 'build'; // 체험판은 항상 3D 만들기 화면

const $ = s => document.querySelector(s);
const store = {
  get(k) { try { const v = localStorage.getItem('polyguess.demo.' + k); return v == null ? null : JSON.parse(v); } catch { return null; } },
  set(k, v) { try { localStorage.setItem('polyguess.demo.' + k, JSON.stringify(v)); } catch { /* 저장 못 해도 계속 */ } },
};
let toastTimer = 0;
function toast(text, ms = 2600) { const t = $('#toast'); t.textContent = text; t.classList.remove('hidden'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), ms); }

// 제시어 + 🎲
let prompt = store.get('prompt') || pickRandom(PROMPT_SUGGESTIONS);
function showPrompt() { $('#build-prompt').textContent = `“${prompt}”`; store.set('prompt', prompt); }
const dice = document.createElement('button');
dice.className = 'dice-btn'; dice.id = 'btn-dice'; dice.title = '다른 제시어 뽑기'; dice.setAttribute('aria-label', '다른 제시어'); dice.innerHTML = ICONS.dice;
dice.onclick = () => { let p; do p = pickRandom(PROMPT_SUGGESTIONS); while (p === prompt); prompt = p; showPrompt(); };
showPrompt();

// 도구 (pad-tools 를 채운 뒤에 🎲 를 맨 앞에 끼운다)
const editor = mountEditor($('#editor'));
$('#pad-tools').prepend(dice);
const saved = store.get('scene');
resetEditor(saved ? sanitizeScene(saved) : emptyScene());
if (saved?.objects?.length) toast('지난번에 만들던 것을 이어서 불러왔어요');
else toast('아래 도형 그림을 눌러 넣어 보세요. 빈 곳을 끌면 시점이 돌아가요', 4000);

// 이 브라우저에 자동 저장
let lastSaved = '';
function save() { const j = JSON.stringify(editor.toJSON()); if (j !== lastSaved) { lastSaved = j; store.set('scene', JSON.parse(j)); } }
setInterval(save, 3000);
window.addEventListener('pagehide', save);
document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });

// 모두 지우기(두 번 눌러 확인 — 대화상자 없이) : 오른쪽 도구 기둥 맨 아래
let clearArmed = 0;
const clearBtn = document.createElement('button');
clearBtn.className = 'tbtn danger'; clearBtn.id = 'btn-clear'; clearBtn.title = '모두 지우고 처음부터 (두 번 누르기)'; clearBtn.setAttribute('aria-label', '모두 지우기'); clearBtn.innerHTML = ICONS.close;
clearBtn.onclick = () => {
  if (Date.now() - clearArmed < 3000) { resetEditor(emptyScene()); save(); clearArmed = 0; clearBtn.classList.remove('on'); toast('비웠어요'); return; }
  clearArmed = Date.now(); clearBtn.classList.add('on'); toast('정말 다 지울까요? 3초 안에 한 번 더 누르면 지워요');
  setTimeout(() => { if (Date.now() - clearArmed >= 3000) clearBtn.classList.remove('on'); }, 3200);
};
$('#tools').append(clearBtn);

// 완료! → 다음 사람 눈으로 보기
let viewer = null;
function openPreview() {
  const scene = editor.toJSON();
  if (!scene.objects.length) return toast('아직 아무것도 없어요. 아래 도형 그림을 눌러 넣어 보세요!');
  save();
  $('#preview').classList.remove('hidden');
  const box = $('#preview-viewer'); box.replaceChildren();
  viewer = new Viewer(box, { autoRotate: true }); viewer.load(scene);
}
function closePreview() { $('#preview').classList.add('hidden'); viewer?.dispose(); viewer = null; }
$('#build-done').onclick = openPreview;
$('#preview-back').onclick = closePreview;
$('#preview-close').onclick = closePreview;
$('#preview').addEventListener('click', e => { if (e.target === e.currentTarget) closePreview(); });
window.addEventListener('keydown', e => { if (e.key === 'Escape') closePreview(); });

window.__dbg = { editor: getEditor, prompt: () => prompt };
