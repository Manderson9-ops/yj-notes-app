# 테마 시스템 설계

- What: 화면 테마 3종(기본·크레용·숲)을 한 앱 안에서 바꾸는 구조와 규칙.
- Why: 화면을 새로 만들 때마다 테마별로 따로 손대지 않고, 접근성·성능 기준을 자동으로 지키기 위해.
- How: 아래 토큰 계약을 지키는 CSS 파일과 장식 SVG 만 테마별로 두고, 화면 코드는 토큰·공용 클래스만 쓴다.

결정 배경은 `docs/adr/0007-selectable-visual-themes.md`, 그림체 연구는 `style-study-*.md`, 테마별 규칙은 `theme-*.md`.

## 1. 구조

| 층 | 파일 | 테마별로 바뀌나 |
|---|---|---|
| 토큰 계약 | `src/styles/tokens.css` (기본 테마 값) | 값만 바뀜 |
| 테마 값 | `src/styles/themes/crayon.css`, `forest.css` | 예 (`:root[data-theme="…"]` 범위) |
| 공용 컴포넌트 CSS | `src/styles/base.css`, `components.css` | 아니오 (토큰만 참조) |
| 장식 | `src/components/decor/*.tsx` (인라인 SVG, `aria-hidden`) | 예 (`ThemeDecor` 가 테마별로 고름) |
| 장식 폰트 | `public/fonts/*.woff2` (부분 집합) | 예 (테마 고를 때 지연 로드) |
| 상태 | `src/lib/theme.ts` (`yj.theme`, `data-theme`, `theme-color`) | — |

## 2. 토큰 계약

모든 테마는 아래 토큰을 **라이트·다크 둘 다** 정의한다. 새 토큰은 이 표에 먼저 추가한다.

| 그룹 | 토큰 | 용도 |
|---|---|---|
| 색 | `--c-bg`, `--c-fg`, `--c-muted`, `--c-border`(컨트롤 경계, 3:1), `--c-line`(장식선, 기준 밖), `--c-surface`, `--c-surface-2` | 바탕·글자·보조 글자·경계·카드·섹션 면 |
| 색 | `--c-accent`, `--c-on-accent`, `--c-accent-soft`, `--c-on-accent-soft`, `--c-link` | 주 행동·선택 상태·링크 |
| 색 | `--c-badge`, `--c-on-badge`, `--c-earth`(메타정보) | 배지·날짜 |
| 색 | `--c-deco-1`, `--c-deco-2`, `--c-deco-3`, `--c-cloud` | 장식 SVG 전용(글자 금지, 대비 기준 밖). `--c-cloud` = 구름 몸통(다크에서도 하늘 면 위에서 보이게) |
| 색 | `--c-shadow` | 그림자 색(오프셋 그림자 테마는 `--shadow` 에 이 색을 씀. 대비 기준 밖. 크레용 다크는 밝은 베이지 대신 바탕보다 어두운 `#0D0A09`) |
| 색(숲 전용) | `--c-hill-front` | 맨 앞 언덕. 계약 밖(숲 CSS 에만 있고 다른 테마는 쓰지 않음). 항상 뒤 언덕보다 어둡게 |
| 색 | `--c-warn`, `--c-alert`, `--c-ok`, `--c-info` + 각 `-bg` | 상태 배지(판정 아님, 상태 표시만) |
| 글꼴 | `--font-body`, `--font-display` | 본문 / 정적 UI 문구 |
| 크기 | `--fs-base`, `--fs-lg`, `--fs-xl`, `--fs-sm`, `--lh-base` | 큰 글씨 설정이 덮어씀 |
| 모양 | `--radius`, `--radius-lg`, `--bw`(경계 두께), `--shadow`, `--shadow-press` | 카드·버튼 |
| 질감 | `--tex-bg`, `--tex-surface` | 배경 그림(`none` 허용). 글자 뒤에는 대비를 깎지 않는 옅은 질감만 |
| 동작 | `--ease`, `--dur` | 전환. `prefers-reduced-motion` 에서 0 |
| 간격 | `--tap`, `--space-1…6` | 테마 무관(바꾸지 않음) |

## 3. 지켜야 할 기준 (테마 공통 하드 게이트)

| ID | 기준 | 확인 방법 |
|---|---|---|
| TH-1 | 6 조합 모두 본문 대비 ≥ 4.5:1 (`fg/bg`, `fg/surface`, `muted/bg`, `on-accent/accent`, 상태색/상태 바탕) | `src/styles/contrast.test.ts` 가 CSS 를 읽어 계산. 단색 토큰 쌍 + **배경 층 최악 지점**: `--tex-bg` 의 rgba/hex 색 정지점을 `--c-bg` 위에 최대 알파로 합성(겹친 경우 포함)하고, 그 위에 종이 결 최악(실측 a·(1−v) 최대 .354 / a·v 최대 .727 × opacity)을 더해 fg·muted·link·earth·accent ≥ 4.5, border ≥ 3 을 확인. 수채 번짐(`--blob-alpha`) 위 fg·muted, 테마 전용 쌍(크레용 `on-hl/hl`)도 확인. 대조군 테스트 포함 |
| TH-2 | UI 경계·포커스 링 대비 ≥ 3:1 | 같은 테스트 |
| TH-3 | axe serious/critical 0 (6 조합 × PIN·홈·설정·미리보기) | `e2e/a11y.spec.ts` |
| TH-4 | 터치 영역 ≥ 48px, 큰 글씨 설정 유지 | `e2e/large-text.spec.ts`: 3테마 × (보통·큰 글씨) 에서 `.key .chip .btn .btn-primary .tab .theme-option` 의 `boundingBox` 높이·너비 ≥ 48, 키 글자 넘침 없음, axe 0, 스크린샷 `*-<테마>-large-light.png` |
| TH-5 | `prefers-reduced-motion` 에서 움직임 0 | CSS 규칙 + e2e |
| TH-6 | **초기 로드**(index.html 이 직접 부르는 JS+CSS) gzip ≤ main 기준값 119.50 KB + **20 KB**(= 139.50 KB), 전체 JS(lazy 청크 포함) gzip ≤ 200 KB(docs/08 Q-PERF), 폰트는 파일마다 ≤ 80 KiB(81,920 B), 기본 테마에선 폰트 요청 0 | `npm run build && npm run size:check`(위 세 한도를 넘으면 실패; 로컬 `check` 에는 넣지 않고 CI check 잡이 build 직후 실행) + `e2e/theme.spec.ts` 의 폰트 요청 수 확인. 한도를 넘으면 한도를 늘리지 말고 초기 청크에 든 것을 `React.lazy` 로 옮긴다. 기능 카드별 임시 여유값은 두지 않는다 |
| TH-7 | 캐릭터·로고·원화·대사·상표명 UI 노출 0, 외부 이미지 0 | 리뷰 체크리스트 §5 |
| TH-8 | 화면 코드에 테마 분기 없음 (`data-theme` 문자열은 `theme.ts`·CSS·decor 에만) | `grep` 리뷰 |
| TH-9 | CSP 변경 없음 (`style-src 'self'`, 인라인 `<style>` 없음) | `server/http/headers.ts` 무변경 |

## 3-1. 진지한 영역

`data-tone="serious"` 를 붙인 영역(검진·성장·주의 안내) 안에서는 모든 테마가 장식 SVG 를 숨기고 장식 모션·오프셋 그림자를 끈다. 화면 코드는 속성만 붙이고, 처리는 테마 CSS 가 한다.

## 4. 운영

| 일 | 방법 |
|---|---|
| 테마 바꾸기 | 설정 → 「화면 테마」 → 기본/크레용/숲. 기기마다 따로 저장 |
| 새 테마 추가 | ① 그림체 연구 문서 ② `theme-<id>.md` ③ `themes/<id>.css` 에 §2 토큰 전부 ④ decor SVG ⑤ `THEMES` 목록 ⑥ 대비 테스트·axe 통과 ⑦ ADR 갱신 |
| 새 화면 만들기 | 토큰·공용 클래스만 사용. 색 hex 직접 쓰기 금지. 미리보기 화면에 새 컴포넌트 상태 추가 |
| 폰트 부분 집합 다시 만들기 | 정적 UI 문구를 바꿨으면 `npm run fonts:subset` 후 커밋. 빠진 글자는 시스템 글꼴로 보임(깨지지 않음) |
| 번들 크기 확인 | 빌드 뒤 `npm run size:check`(CI check 잡에서도 build 직후 실행). 한도(초기 +20 KB, 전체 JS 200 KB, 폰트 80 KiB)는 `tools/size/check.ts` 상단 상수. 통합 시점(2026-10-03, 6개 카드 병합 후) 측정: 초기 로드 137.43 KB(main 대비 +17.93 KB), 전체 JS 156.37 KB. 화면은 모두 lazy 청크. **기준값 측정법**: main 을 빌드한 `dist/` 에 같은 스크립트를 돌린다(`node tools/size/check.ts <main 의 dist>`) → 119.50 KB(zlib 기본 레벨, 1 KB = 1000 B). Vite 의 "gzip: N kB" 출력과는 약 1% 달라 섞어 비교하지 않는다 |
| 스크린샷 갱신 | `npm run test:e2e` 가 `e2e/__screenshots__/<화면>-<테마>-<light|dark>.png` 로 저장. **로컬 Windows 에서는 커밋된 PNG 와 비교**(`toMatchSnapshot`: 다른 픽셀 비율 `maxDiffPixelRatio` 0.002 이하, 픽셀별 색 차이 `threshold` 0.05 — `playwright.config.ts`) — 디자인을 일부러 바꿨으면 `npx playwright test --update-snapshots` 후 PNG 를 커밋. CI(linux 컨테이너)는 렌더가 달라 비교하지 않고 저장만. **민감도 변이 시험(2026-10-02)**: 숲 `--c-deco-2` `#66a063` → `#a06066`(밝기 비슷한 색상만 변경)은 `pin-forest-light` 에서 26,263 픽셀(비율 0.03) 차이로 **실패**(기본 threshold 0.2 에서는 통과해 놓쳤음), `#ff00ff` 같은 큰 변화는 당연히 실패, `#6c9d66`(미세 변화)은 통과. 같은 설정에서 e2e 연속 3회 통과(비결정성 없음) |
| 전체 페이지 스크린샷 | `stableShot` 은 fullPage 캡처 대신 **뷰포트를 페이지 높이만큼 키워** 찍고(position:fixed 배경 층이 첫 화면 높이에서 끊겨 중간에 경계선이 생기는 캡처 산출물 방지), 그동안 sticky 탭바에 `.is-static-for-shot`(base.css)를 달아 중간에 찍히지 않게 함 |
| 요소 단위 시각 회귀 | `e2e/elements.spec.ts`: 테마(크레용·숲) × light/dark 의 h2 띠·선택 칩·주 버튼을 요소만 찍어 `threshold` 0.02 로 비교(`el-<요소>-<테마>-<scheme>.png`). **변이 시험(2026-10-02)**: 크레용 `--c-hl` `#ffd4da` → `#f6cfe6` 은 `el-h2-crayon-light` 에서 6,496 픽셀(요소의 60%) 차이로 **실패**, 같은 변이가 전체 화면 비교(threshold 0.05)에서는 통과 — 그래서 요소 단위를 둔다 |

## 4-1. 렌더 비용 규칙 (T-A2, 2026-10-03)

**What**: 테마가 화면 렌더에 쓰는 비용을 낮게 유지하는 규칙. **Why**: CI(리눅스 컨테이너·소프트웨어 렌더) 웹킷에서 크레용 라이트·다크만 30초 시간 초과(`page.evaluate`·axe 무응답)였다. 저사양 폰(조부모)도 같은 비용을 낸다. 시간 제한을 늘려 덮지 않고 원인을 없앤다. **How**:

| 규칙 | 대신 쓰는 것 |
|---|---|
| **CSS `filter`(`drop-shadow` 포함)·`backdrop-filter` 금지**(요소마다 필터 합성 층) | 오프셋 그림자는 `box-shadow`(+`border-radius`). 크레용 `--lift` |
| **실시간 SVG 필터(`<filter>`·feTurbulence·feDisplacementMap·feGaussianBlur 등) 금지** — decor SVG·CSS·data URI 모두 | 정적 텍스처: 작은 `<pattern>`(점·짧은 선·옅은 얼룩)을 `<mask>`/`fill` 로, 또는 한 번 구운 PNG(`public/icons/tex-*.png`, 생성 `tools/perf/make-forest-textures.ts`) |
| 화면 전체 고정 층(`position:fixed; inset:0` + `opacity`)은 최소로 | 숲 종이 결 1장만 허용(가장 비싼 층으로 남음) |

자동 확인: `src/styles/render-cost.test.ts`(CSS 전부에 `filter:`·`drop-shadow(`·`feTurbulence`·`<filter` 0개, decor `.tsx` 에 `<filter`·`fe*`·`filter=` 0개, 대조군 포함). 새 장식·질감을 넣을 때는 이 규칙을 지키고, 아래 측정 스크립트로 기본 테마 대비 배수를 확인한다.

**측정**: `npm run dev:mock`(E2E_PORT) 을 띄우고 `node tools/perf/render-cost.ts [webkit|chromium] [cpuRate]`(테마×라이트/다크×홈·미리보기: 색 변경 뒤 rAF 2회까지 `repaint`, 화면 `screenshot` 시간 `shot`, axe 시간). 전/후 비교는 이전 커밋을 다른 작업 트리로 띄워 두 서버를 번갈아 잰다(`tools/perf/render-ab.ts`). PC 부하 잡음이 커서(같은 코드가 실행마다 ±50%) **최소값**을 쓰고 번갈아 2회 이상 잰다.

**측정 결과** (Windows 로컬, 360×740 DPR2, 라이트, 미리보기=디자인 미리보기 화면, 최소값 ms, 전→후, 번갈아 2회 값. 모두 **실측**):

| 엔진 | 테마·화면 | repaint(rAF×2) | shot(스크린샷) |
|---|---|---|---|
| webkit | 기본 홈 | 16/17 → 16/16 | 31/39 → 32/31 |
| webkit | **크레용 홈** | 49/46 → **26/26** | 158/178 → **45/44** |
| webkit | **크레용 미리보기** | 60/59 → **27/29** | 94/105 → **63/63** |
| webkit | 숲 홈 | 72/75 → 57/47 | 178/185 → 137/147 |
| webkit | 숲 미리보기 | 47/63 → 55/63 | 122/125 → 120/179 (잡음) |
| chromium ×6 감속 | 기본 홈 | 9/15 → 10/8 | 51/53 → 54/55 |
| chromium ×6 | 크레용 홈 | 14/13 → 17/18 | 57/57 → 51/49 |
| chromium ×6 | 크레용 미리보기 | 11/30 → 40/38 | 70/58 → 64/60 |
| chromium ×6 | 숲 홈 | 12/15 → 10/18 | 201/201 → 166/172 |
| chromium ×6 | 숲 미리보기 | 26/36 → 28/25 | 158/154 → 130/130 |

해석(추론 포함): 문제의 웹킷에서 크레용이 기본 테마의 약 3배 → 약 1.6배(홈 repaint)로 내려갔다(실측). chromium ×6 에서는 크레용 repaint 가 개선되지 않았다(미리보기는 오히려 큼, 실측): chromium 은 필터를 GPU·래스터 쪽에서 처리해 원래 이 문제가 없었고, 필터 대신 `box-shadow`·마스크가 메인 스레드 그리기로 옮겨 간 것으로 **추정**(원인 분리 시험은 마스크·box-shadow 를 각각 꺼도 변화 없음 → 미확인). 숲은 개선 폭이 작고 잡음 안이다. 숲 종이 결 층을 끄면 웹킷 재칠이 ~30% 줄었다(1회 시험, 잡음 큼). 기본 테마 대비 크레용·숲은 여전히 웹킷에서 약 1.5~3배이므로 새 장식은 위 규칙 안에서 보수적으로 늘린다.

## 5. 저작권·상표 체크리스트 (PR 마다)

- [ ] 캐릭터(사람·동물·괴물)를 그리지 않았다. 사람 형태는 쓰지 않는다.
- [ ] 작품 로고·제목 글자·효과음 글자·대사를 흉내 내지 않았다.
- [ ] 외부 이미지 파일·스크린샷을 넣지 않았다. 모든 장식은 직접 그린 SVG 다.
- [ ] 화면 문구에 작품명·회사명이 없다(「크레용」「숲」만).
- [ ] 폰트는 OFL 등 재배포 가능 라이선스이고 `public/fonts/LICENSES.md` 에 적었다.

## 구현 메모 (T-D1, 2026-10-02)

| 항목 | 구현 | 설계와 다른 점·이유 |
|---|---|---|
| `--c-border`(기본 테마) | 라이트 `#7d838c`, 다크 `#737a85` | 기존 `#d9dce1` 은 흰 바탕 대비 1.4:1 이라 TH-2(3:1) 불가. 옛 값은 `--c-line`(장식선)으로 옮겨 구분선에 계속 씀 |
| 크레용 `--c-link`·`--c-earth`·`--c-badge`·`--c-on-badge` | 명세에 없어 추가 | 계약상 모든 테마가 정의해야 함. 링크=포인트 파랑, 배지=노랑 면, earth=갈색 |
| 종이 결 질감 | 구현(숲): `body::after` 에 종이 결 PNG 타일(`public/icons/tex-forest-grain.png`, 원래 feTurbulence 로 한 번 구운 것), opacity .055/.05, z-index -1(T-A2 에서 data URI → PNG) | CSS 파일 안 `url(data:)` 는 CSP `img-src data:` 허용. 맨 뒤 층이라 카드·버튼·입력 면 위에는 없음(1차 구현 메모를 번복) |
| 큰 글씨·`--font-display` | 앱 이름·h1·h2·탭·`.btn` 에만 | 숫자·PIN 키는 본문 글꼴 + tabular-nums |
| 폰트 부분 집합 글자 | 소스(테스트·주석 제외)의 한글 + ASCII | 글자 목록은 `tools/fonts/subset.ts` 가 재현 |
| 스와치 색 | 각 테마 CSS 가 자기 스와치를 정의(hex) | 선택지에서 다른 테마 색을 보여야 해 토큰 불가 |
| 대비 테스트 항목 | 명세 + `earth/bg·surface`, `accent/bg·surface`, `link/surface`, `muted/surface-2` 추가(대조군 테스트 포함) | 같은 토큰을 글자로 쓰므로 |
| 큰 글씨 스위치 | 크레용·숲은 `appearance:none` + 체크 표시(CSS 만) | 기본 테마는 네이티브 |
| 빈 상태 변형 | `ThemeDecor slot="empty" variant="home / logs / notes / library"` | 화면 코드는 variant 만 넘기고 테마를 모름 |
| `--font-display` 범위 | 크레용: 앱 이름·h1·h2·탭·버튼 / 숲: 앱 이름·h1·h2 만(20px 이상) | 테마 명세대로 |
| 큰 글씨의 작은 글자 | `--fs-sm` = `max(14px, 0.82 × --fs-base)` (탭 라벨·배지·메타·버전·키 보조 글자) | 큰 글씨에서 고정 14px 가 남던 문제. e2e 가 탭 라벨 > 14px 확인 |
| 한글 줄바꿈 | `body { word-break: keep-all; overflow-wrap: anywhere }` | 단어 중간 끊김 방지 |
| TH-8 자동 확인 | `src/theme-isolation.test.ts` | pages·app·components(decor 제외)에 `data-theme`·`"crayon"`·`"forest"` 0개 |
| 스크린샷 안정화 | `e2e/helpers.ts` 의 `stableShot` (찍는 순간만 reduced-motion) | 흔들리는 잎 때문에 PNG 가 달라지던 문제 |

### 장식 글꼴 크기 여유 (T-E1)
- `size:check` 는 woff2 가 80 KiB 에서 8 KiB 안쪽으로 다가오면 경고한다(실패 아님).
- 부분 집합에서 숫자(0-9)를 뺐다: 숫자는 본문 글꼴 + tabular-nums 규칙(위 표)이라 장식 글꼴에 필요 없다. 크레용 78,616 → 76,864 B, 숲 43,920 → 41,284 B. 제목 속 숫자(예: 날짜 h1)는 본문 글꼴로 보인다.
- 영문 대문자·소문자는 남겼다(제목·단추에 `BMI` 같은 영문이 나올 수 있고 빠지면 글꼴이 섞인다). 크기의 대부분은 한글 음절(약 290자)이라 ASCII 를 더 빼도 얻는 것이 적다.
- 크레용 여유가 약 5 KB 로 경고선(8 KB) 안쪽이다. 한글 음절이 약 30자 늘면 한도를 넘는다: 그때는 화면 문구를 줄이거나 크레용 장식 범위(`.btn` 등)를 제목 위주로 좁힌다.
