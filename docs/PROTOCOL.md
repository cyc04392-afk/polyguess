# 폴리게스 통신 규격 · 작품 포맷

JSON over WebSocket. 서버가 권위를 가지며(타이머, 라운드 전환, 점수), 클라이언트는 상태를 받아 그리기만 한다.
엔진을 바꿔도(유니티 등) 이 문서와 `shared/` 만 맞추면 같은 서버에 붙을 수 있다.

## 1. 접속

| 방향 | 메시지 | 설명 |
|---|---|---|
| C→S | `{type:'join', lobby?, name, avatar:{shape,color}, lang?}` | `lobby` 가 없으면 새 방. 게임 중인 방에는 끊겼던 사람만(같은 이름) 다시 들어갈 수 있다. `lang` 은 그 사람의 언어 코드(`ko`·`en`·`ja`·`zh`·`fr`·`de`, 없으면 `ko`) — 빈 이름을 채울 때와 거절 안내문에 쓰고, **방장의 언어가 방의 언어**가 되어 제시어 추천·시간 초과 때 채워 넣는 글이 그 언어로 나간다 |
| S→C | `{type:'welcome', you, name, lobby}` | 내 id, 확정된 이름(중복이면 숫자 붙음), 방 코드 |
| S→C | `{type:'lobby', lobby, hostId, players:[{id,name,avatar,score,likes,connected}], settings, inGame, canStart:{ok,key?,params?}}` | 방 상태. 변화가 있을 때마다 전원에게. `likes` 는 그 사람이 이 방에서 받은 따봉 누적. `canStart` 가 `ok:false` 면 `key`+`params` 로 이유를 주고 클라이언트가 자기 언어로 번역한다 |
| C→S | `{type:'leave'}` | 방 나가기 → S→C `{type:'left', lobby}` 뒤 명단에서 제거(게임 중이면 자리만 비움). 그 뒤 다른 방에 `join` 할 수 있다 |
| S→C | `{type:'error', key, params?, text}` | 안내문. `key` 는 한국어 원문(번역 사전의 키), `params` 는 자리표 값(`{code}`·`{min}`·`{n}` 등), `text` 는 그 사람(또는 방) 언어로 채워 넣은 완성문. 클라이언트는 `key`+`params` 를 자기 언어로 다시 번역해 보여 주고, 모르는 키면 `text` 를 그대로 쓴다 |

### 1.1 언어

- 화면 글자는 전부 클라이언트가 번역한다(`shared/i18n.js` + `shared/lang/<code>.js`, 키는 한국어 원문). 서버는 글자를 거의 보내지 않고, 보내야 할 때는 위처럼 `key`+`params` 를 함께 보낸다.
- 서버가 언어를 알아야 하는 곳은 셋뿐: 빈 닉네임 채우기(`플레이어{n}`), 제시어 추천(`task.suggestions`, 방 언어), 시간 초과 때 빈 글 채우기(첫 라운드는 랜덤 제시어, 그 뒤는 `(시간이 다 됐어요…)`, 방 언어).
- 방 언어 = 방장이 `join` 할 때 보낸 `lang`. 방장이 바뀌어도 방 언어는 그대로다(한 판 안에서 글이 섞이지 않게).

## 2. 방

| 방향 | 메시지 |
|---|---|
| C→S (방장) | `{type:'settings', settings:{mode?, time?, write?, build?, guess?, turns?, scoreboard?, selfBuild?, tutorial?, maxPlayers?}}` — 일부만 보내도 됨 |
| C→S (방장) | `{type:'preset', key}` — `shared/rules.js` 의 `PRESETS` 키 |
| C→S | `{type:'avatar', avatar}` |
| C→S (방장) | `{type:'start'}` / `{type:'abort'}` |
| C→S | `{type:'chat', text}` → S→C `{type:'chat', from, name, text}` (맞추기 중 맞추는 사람의 채팅은 추측으로 처리) |

settings: `mode` `'chain'|'guess'`, `write`/`build`/`guess` 초(10..600), `turns` `'all'|2..14`, `scoreboard` bool, `selfBuild` bool(글을 쓴 사람이 직접 3D로 만들기. 다같이 맞추기: 2명이면 항상 켜진 채로 시작. 릴레이: 한 사람이 글 → 3D 한 쌍을 맡아 라운드 수가 턴 수의 두 배. 게임의 `settings.selfBuild` 에 실제 적용값이 담긴다), `maxPlayers` 2..14. 최소 인원은 릴레이 3명·다같이 맞추기 2명(`minPlayersFor`). 방은 초대 링크/코드로만 들어갈 수 있다(열린 방 목록 없음).
`time` 은 서버가 숫자들을 보고 붙이는 이름표(`'fast'|'normal'|'relaxed'|'custom'`; 빠름 25/60/60, 보통 45/300/60, 느긋하게 90/480/60 초). `tutorial` bool 은 3D 만들기 화면 옆 단축키 안내 표시. 패치에 `time` 이름표를 넣어 보내면 서버가 그 빠른 선택의 숫자로 채운다(`shared/rules.js applySettings`).

## 3. 진행

모든 단계 전환은 `phase` 메시지 하나로 알린다. 재접속해도 같은 메시지로 복구된다.

```
{type:'phase', phase:'step'|'album'|'guess'|'score'|'lobby', serverNow, settings, seats:[id], players, round, rounds, deadline?, done?, task}
```

`serverNow` 로 시계 차이를 보정해 `deadline` 까지 남은 시간을 계산한다.

### 3.1 step (글 쓰기 / 3D 만들기)

```
task: { type:'write'|'build', album, author,
        prev: { type, by, text, scene } | null,   // 이어받을 앞 장면 (0라운드는 null)
        mine: { text, scene },                     // 내가 이미 낸 것(재접속용)
        suggestions: [string],                     // 0라운드 글 쓰기에만 4개
        progress: [id] }                           // 이미 완료한 사람
```

| 방향 | 메시지 |
|---|---|
| C→S | `{type:'submit', text}` 또는 `{type:'submit', scene, timelapse?}` → S→C `{type:'submitted', done:true}` — `timelapse` 는 만드는 과정(5장 참고). 없거나 깨지면 null |
| C→S | `{type:'unsubmit'}` (수정하기) → `{type:'submitted', done:false}` |
| S→C | `{type:'progress', done:[id]}` |

시간이 끝나면 클라이언트가 가진 것을 자동 제출하고, 서버는 3초 더 기다린 뒤 빈 칸을 채운다
(0라운드 빈 글 → 랜덤 제시어, 그 외 빈 글 → "(시간이 다 됐어요…)", 빈 3D → 빈 장면).

라운드 r 의 담당: 앨범 a 는 `seats[(a + r) % n]`, 짝수 라운드는 글, 홀수 라운드는 3D. 릴레이에서 `selfBuild` 가 켜지면 `seats[(a + ⌊r/2⌋) % n]`(같은 사람이 글 다음 3D까지), 라운드 수 = 턴 × 2. (`shared/rules.js stepAssignee/roundCount`)

### 3.2 album (릴레이 공개)

`task: { albums:[{author, steps:[{type, by, text, scene, likes:[id]}]}], index, step, timelapse }` — `timelapse` 는 지금 보는 장면의 만드는 과정(3D 단계가 아니거나 없으면 null). 앨범 전체에 싣지 않고 보는 장면 것만 보낸다.
다같이 맞추기도 작품을 다 맞춘 뒤 같은 앨범 단계로 온다. 그때 각 앨범의 steps 는 `[write, build, guesses]` 이고 `guesses` 장면은 `{type:'guesses', by:null, text:null, scene:null, likes:[], guesses:[{id, from, name, text, correct}], solved:[id]}` (그 작품에 모두가 적은 답).

| 방향 | 메시지 |
|---|---|
| C→S (방장) | `{type:'albumNext'}` `{type:'albumPrev'}` `{type:'albumGo', album, step}` |
| S→C | `{type:'album', index, step, serverNow, timelapse}` — 받는 쪽은 장면을 먼저 보여주고 `timelapse` 가 있으면 빈 바닥에서 완성까지 재생한 뒤 멈춘다(과정 다시 보기 버튼으로 재생 반복) |
| C→S (방장) | `{type:'toLobby'}` (릴레이: 앨범 끝 → 대기실) |
| C→S (방장) | `{type:'toScore'}` (다같이 맞추기: 앨범 끝 → `phase:'score'`) |
| C→S | `{type:'like', album, step}` — 3D 단계(type 'build')에만, 본인 작품은 불가, 다시 보내면 취소. album/guess/score 단계에서 가능 |
| S→C | `{type:'likes', album, step, likes:[id], players}` — 전원에게. `players[].likes` 가 만든 사람의 누적 따봉 |

### 3.3 guess (다같이 맞추기)

`task: { albums (scene 만, text 는 null), round }`

```
round: { idx, total, author, builder, guessers:[id], deadline, done,   // guessers = author·builder 를 뺀 나머지(맞출 수 있는 사람)
         answer,            // 출제자이거나 끝난 뒤에만, 아니면 null
         guesses:[{id, from, name, text|null, correct, exact?}],   // text 는 본인·출제자·제작자·정답만 보임
         solved:[id], result:{solved, answer}|null,
         timelapse }       // 라운드가 끝난(done) 뒤에만 3D 의 만드는 과정, 아니면 null (맞추는 동안은 완성본만)
```

| 방향 | 메시지 |
|---|---|
| C→S | `{type:'chat', text}` — 맞추는 사람이 보내면 추측 |
| S→C | `{type:'guessMade', guess, players?, solved?}` |
| C→S (출제자) | `{type:'judge', guessId}` — 뜻이 맞는 답을 정답으로 인정 |
| C→S (출제자·방장) | `{type:'skipRound'}` |
| S→C | `{type:'guessResult', idx, answer, solved, guesses, players}` — 시간이 끝나거나(또는 맞추는 사람이 모두 맞히면) 정답과 모두의 답(`guesses` 전체, text 포함)을 5초 동안 보여 준 뒤 `{type:'guessRound', round, serverNow}` 또는 마지막 작품이면 `phase:'album'` |

`guessMade`/`round.guesses` 의 `text` 는 출제자·제작자·본인에게만 있고 다른 맞추는 사람에게는 null 이다. **정답으로 인정된 답(`correct:true`)도 라운드가 끝날 때까지는 글자가 가려진다**(정답이 새지 않게). 정답 인정(`judge`·정확히 일치)은 점수만 바로 주고, 공개는 라운드 끝에 한 번에.

점수(`SCORE`): 첫 정답 3, 이후 정답 1, 제작자 2(누군가 맞혔을 때), 출제자 1.

### 3.4 score

`task: { albums }` — 방장이 `toLobby`. (다같이 맞추기는 앨범에서 방장이 `toScore` 를 보내야 이 단계로 온다.)

## 4. 작품(Scene) 포맷 — `shared/scene.js`

```
{ v: 1, bg: 0..6, objects: [
  { id, kind, p:[x,y,z], q:[x,y,z,w], s:[sx,sy,sz], mat:{ c:'#rrggbb', f:'basic'|'shiny'|'metal'|'glass'|'glow' },
    mesh?:  { pos: base64(Float32[]), fv: base64(Uint32[]), fn: base64(Uint8[]) },   // kind === 'mesh'
    light?: { type:'sun'|'point'|'spot', i: 0.1..6, a: 10..80 },                   // kind === 'light'
    paint?: { pal:['#rrggbb', …], f: base64(Uint8[]) } }                            // 면 색칠(기본 도형·메시)
] }
```

- `kind`: 기본 도형 14종(`PRIM_KINDS`: box sphere cylinder cone torus capsule slab pyramid hemisphere prism3 prism6 star heart clay) · `mesh`(찰흙·베벨·루프 자르기·밀어내기 등으로 다듬은 다각형 메시) · `light`(광원).
- **다각형 메시**: `pos` 는 꼭짓점 좌표(3개씩), `fn` 은 면마다 꼭짓점 개수(3 이상, 삼각형·사각형·n각형 모두 허용), `fv` 는 모든 면의 꼭짓점 번호를 이어 붙인 것(`fn` 의 합 = `fv` 길이). 면은 바깥에서 봤을 때 반시계 방향. 렌더링할 때는 삼각형은 그대로, 사각형은 대각선으로, 5각 이상은 중심점을 더해 부채꼴로 쪼갠다(`shared/polymesh.js pmRenderBuffers`). 옛 포맷 `{ pos, idx(삼각형 인덱스)|null }` 도 읽어서 삼각형 면으로 바꾼다.
- **면 색칠(`paint`)**: `f` 는 면마다 1바이트(면 수와 길이가 같아야 함). 0 = 물체 색 `mat.c`, k = `pal[k-1]`. 팔레트는 최대 32색. 기본 도형의 면 번호는 `shared/primitives.js makePrimitive(kind, kind==='clay')` 가 만드는 순서, 메시는 `fn` 순서. 렌더링은 칠한 면이 하나라도 있으면 재질 색을 흰색으로 두고 꼭짓점 색(면마다 실제 색, 안 칠한 면은 물체 색)을 곱한다. 위상이 바뀌는 연산은 `faceOrigin`(새 면 → 원래 면)으로 색을 물려주고(`shared/paint.js remapPaint`), 대응을 모르면 같은 평면·비슷한 법선·가까운 면에서 가져온다(`transferPaint`). 서버는 길이가 안 맞거나 깨진 `paint` 를 버린다.
- **광원**: 위치는 `p`, 방향은 `q` (오브젝트의 −Y 축이 빛의 방향, 즉 기본값은 아래를 비춤), `s` 는 항상 [1,1,1]. `i` 세기, `a` 스포트 원뿔 각도(도). 장면에 광원이 하나라도 있으면 기본 햇빛은 약해진다(에디터·뷰어 공통, `sceneio.js createEnvironment.setUserLights`). 광원 표시용 그림(해 모양 등)은 저장되지 않는 뷰어 전용 도우미다.
- 단위는 미터 느낌의 임의 단위. 바닥은 y=0. 기본 도형은 각 축 1 크기 안에 들어가고 원점이 중심(`shared/primitives.js`).
- `s` 는 0.01~200 양수. 좌우 뒤집어 복제할 때 기본 도형은 위치·회전만 거울상으로 바꾸고, 메시는 정점을 x축 대칭으로 뒤집고 면의 방향도 뒤집는다(`pmFlipX`), 광원은 위치와 빛 방향을 거울상으로.
- 서버 검증(`sanitizeScene`): 객체 150개, 메시 정점 80,000개·면 120,000개, 광원 4개, 위치 ±1000, 크기 0.01~200, 모르는 kind·깨진 base64·범위 밖 인덱스·개수 불일치는 객체 제거.
- 재질은 색 하나 + 마감 하나로 단순화해 어느 엔진에서도 쉽게 재현되게 했다. 조명·바닥·배경은 `bg` 인덱스로 프리셋(`sceneio.js BG_PRESETS`).
- 메시 편집 연산(`shared/meshops.js`): `edgeRing`(루프 자르기용 한 바퀴), `edgeLoop`(선 한 바퀴 선택), `loopCut(cuts, slide)`, `bevelEdges(width, segments)`, `extrudeFaces(distance)`, `insetFaces(thickness, depth, individual)`(면 테두리를 안쪽으로 모아 안쪽 면 + 띠. depth 는 법선 방향 이동, individual 은 면마다 따로), `deleteFaces`. 모두 새 메시와 `faceOrigin` 을 돌려주며 유니티 등으로 옮길 때 같은 결과를 내야 하는 규격이다.

## 5. 만드는 과정(Timelapse) 포맷 — `shared/timelapse.js`

```
{ v: 1, n: 스냅샷 수, frames: [ { bg?: 0..6, set?: [Object], del?: [id] }, … ] }
```

- 클라이언트는 3D 만들기 중 작품이 바뀔 때마다(되돌리기 포함) 장면 스냅샷을 모아 두었다가(`editor.frames`, 600장 넘으면 솎음) 완료할 때 `buildTimelapse(snapshots)` 로 **빈 장면에서 시작하는 차이(delta) 목록**으로 줄여 보낸다. 각 frame 은 앞 상태에 `bg` 바꾸기, `set` 의 객체를 같은 id 자리에 넣기(없으면 추가), `del` 의 id 지우기를 순서대로 적용한 것(`applyFrame`).
- 한도(`TIMELAPSE_LIMITS`): frame 240장, 직렬화 1.5MB. 넘으면 처음·끝을 포함해 고르게 솎아(×0.7) 다시 만든다. 스냅샷이 2장 미만이면 null(보내지 않음).
- 서버 `sanitizeTimelapse(tl, finalScene)`: 모양 검사, frame 수 한도, `set` 의 객체마다 `sanitizeObject`, `del` 은 정수만. 마지막에 **제출한 완성 장면과 같아지게 맞추는 frame 을 덧붙이므로** 재생이 끝나면 항상 제출본과 똑같다. 한도의 1.1배를 넘으면 버린다(null). 글 단계에는 없다.
- 재생(`public/js/viewer.js playTimelapse`): 전체가 6초 안팎이 되도록 frame 간격을 45~350ms 에서 정하고 아래 진행 막대를 채운다. 재생 중에는 광원 도우미를 숨기고, 끝나면 완성본 상태로 멈춘다. 스크린샷(📷)을 누르면 즉시 완성본으로 건너뛴다.

