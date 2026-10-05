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
| 상태 | `src/lib/theme.ts` (`yj.theme`, `data-theme`, `theme-color`), `src/lib/scheme.ts` (`yj.scheme`, `data-scheme`), `src/lib/highContrast.ts` (`yj.contrast`, `data-contrast`) | — |
| 선명하게 보기 | `src/styles/contrast-high.css` (`:root[data-contrast="high"]`) | 테마 위에 얹힘(§6-3) |

## 2. 토큰 계약

모든 테마는 아래 토큰을 **라이트·다크 둘 다** 정의한다(다크는 `[data-scheme="dark"]` 규칙). 새 토큰은 이 표에 먼저 추가한다. 실제 값은 §6-1. `--c-line` = 안 눌리는 카드·표 테두리(바탕·면 위 3:1), `--c-divider` = 장식 구분선(옅음, 기준 밖), `--c-meta` = 날짜·메타 글자(기본 테마는 보조 글자색, 크레용·숲은 흙색; 화면 코드는 테마를 모르고 토큰만 씀). 크레용 전용 `--lift`(누르는 것의 오프셋 그림자)·`--band`(카드 띠 높이)는 계약 밖.

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
| TH-1 | 6 조합 모두(T-D1 기준) `line` ≥ 3:1 (bg·surface 위), `meta` ≥ 7:1, `fg` ≥ 12:1, `muted`·`earth`·`link` ≥ 7:1 (각각 bg·surface·surface-2 위), `on-accent/accent` ≥ 6.5, `on-accent-soft/accent-soft`·`on-badge/badge` ≥ 7, 상태색/상태 바탕 ≥ 7 (`accent` 글자 ≥ 4.5) | `src/styles/contrast.test.ts` 가 CSS 를 읽어 계산. 단색 토큰 쌍 + **배경 층 최악 지점**: `--tex-bg` 의 rgba/hex 색 정지점을 `--c-bg` 위에 최대 알파로 합성(겹친 경우 포함)하고, 그 위에 종이 결 최악(실측 a·(1−v) 최대 .354 / a·v 최대 .727 × opacity)을 더해 fg ≥ 12, muted·link·earth ≥ 7, accent ≥ 4.5, border ≥ 3 을 확인. 수채 번짐(`--blob-alpha`) 위 fg ≥ 12·muted ≥ 7, 테마 전용 쌍(크레용 `on-hl/hl`)도 확인. 대조군 테스트 포함 |
| TH-2 | UI 경계·포커스 링 대비 ≥ 3:1 (`border` 가 bg·surface·surface-2 위) | 같은 테스트 |
| TH-10 | 선명하게 보기(`data-contrast="high"`) 6 조합: `fg` ≥ 15:1, `muted` ≥ 10:1, `border` ≥ 7:1, `line` ≥ 3:1, link·accent·earth ≥ 7:1, 질감·오프셋 그림자 없음 | 같은 테스트 + `e2e/a11y.spec.ts` 의 미리보기 6장(`preview-<테마>-<scheme>-high.png`) axe 0 |
| TH-3 | axe serious/critical 0 (6 조합 × PIN·홈·설정·미리보기, 밝기는 `yj.scheme` 로 지정) | `e2e/a11y.spec.ts` |
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
| 밝기·선명하게 보기 | 설정 → 「화면 밝기」(시스템에 맞춤/밝게/어둡게), 「선명하게 보기」 스위치. 기기마다 따로 저장(§6) |
| 새 테마 추가 | ① 그림체 연구 문서 ② `theme-<id>.md` ③ `themes/<id>.css` 에 §2 토큰 전부 ④ decor SVG ⑤ `THEMES` 목록 ⑥ 대비 테스트·axe 통과 ⑦ ADR 갱신 |
| 새 화면 만들기 | 토큰·공용 클래스만 사용. 색 hex 직접 쓰기 금지. 미리보기 화면에 새 컴포넌트 상태 추가 |
| 폰트 부분 집합 다시 만들기 | 정적 UI 문구를 바꿨으면 `npm run fonts:subset` 후 커밋. 빠진 글자는 시스템 글꼴로 보임(깨지지 않음) |
| 번들 크기 확인 | 빌드 뒤 `npm run size:check`(CI check 잡에서도 build 직후 실행). 한도(초기 +20 KB, 전체 JS 200 KB, 폰트 80 KiB)는 `tools/size/check.ts` 상단 상수. 통합 시점(2026-10-03, 6개 카드 병합 후) 측정: 초기 로드 137.43 KB(main 대비 +17.93 KB), 전체 JS 156.37 KB. 화면은 모두 lazy 청크. **기준값 측정법**: main 을 빌드한 `dist/` 에 같은 스크립트를 돌린다(`node tools/size/check.ts <main 의 dist>`) → 119.50 KB(zlib 기본 레벨, 1 KB = 1000 B). Vite 의 "gzip: N kB" 출력과는 약 1% 달라 섞어 비교하지 않는다 |
| 스크린샷 갱신 | `npm run test:e2e` 가 `e2e/__screenshots__/<화면>-<테마>-<light|dark>.png` 로 저장. **로컬 Windows 에서는 커밋된 PNG 와 비교**(`toMatchSnapshot`: 다른 픽셀 비율 `maxDiffPixels` 500 이하, 픽셀별 색 차이 `threshold` 0.05 — `playwright.config.ts`) — 디자인을 일부러 바꿨으면 `npx playwright test --update-snapshots` 후 PNG 를 커밋. CI(linux 컨테이너)는 렌더가 달라 비교하지 않고 저장만. **민감도 변이 시험(2026-10-02)**: 숲 `--c-deco-2` `#66a063` → `#a06066`(밝기 비슷한 색상만 변경)은 `pin-forest-light` 에서 26,263 픽셀(비율 0.03) 차이로 **실패**(기본 threshold 0.2 에서는 통과해 놓쳤음), `#ff00ff` 같은 큰 변화는 당연히 실패, `#6c9d66`(미세 변화)은 통과. 같은 설정에서 e2e 연속 3회 통과(비결정성 없음) |
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

## 6. T-D1 가시성 개선 (ADR-0008)

### 6-1. 토큰 값 (6조합)

| 토큰 | 기본 라이트 | 기본 다크 | 크레용 라이트 | 크레용 다크 | 숲 라이트 | 숲 다크 |
|---|---|---|---|---|---|---|
| `--c-bg` | `#f6f7f9` | `#121316` | `#fffdf5` | `#1b1715` | `#f4efe1` | `#111a18` |
| `--c-surface` | `#ffffff` | `#1f2228` | `#ffffff` | `#2b2421` | `#fffdf6` | `#1f2e2a` |
| `--c-surface-2` | `#e8edf5` | `#2a2e35` | `#d7edf8` | `#372e2a` | `#dceaf0` | `#233430` |
| `--c-fg` | `#16181c` | `#f1f2f5` | `#2a1f1c` | `#fffaf0` | `#1b2721` | `#fffbef` |
| `--c-muted` | `#454a52` | `#bcc1ca` | `#54443d` | `#d6cabd` | `#3d4943` | `#c4ccc0` |
| `--c-border` | `#737984` | `#828995` | `#2a1f1c` | `#9b8c80` | `#7a6b50` | `#80948a` |
| `--c-line` | `#848f9f` | `#666d79` | `#8a7a70` | `#7d6d63` | `#9e8558` | `#607b72` |
| `--c-divider` | `#c4c9d1` | `#3d4148` | `#b5a79c` | `#4b413b` | `#cdbfa5` | `#35443f` |
| `--c-accent` | `#1553b8` | `#a8c7fa` | `#04609e` | `#93d1fb` | `#2a6249` | `#98d1ab` |
| `--c-on-accent` | `#ffffff` | `#0a2350` | `#ffffff` | `#0f1f2b` | `#ffffff` | `#0d1e16` |
| `--c-accent-soft` | `#d8e5fb` | `#1f3a63` | `#fff1a8` | `#4a3f12` | `#d7e8d8` | `#244437` |
| `--c-on-accent-soft` | `#0c3a85` | `#dce8ff` | `#2a1f1c` | `#ffec8f` | `#163a2a` | `#ddf0e3` |
| `--c-link` | `#134aa5` | `#a8c7fa` | `#035083` | `#93d1fb` | `#1c4965` | `#a8d2ea` |
| `--c-badge` | `#ffe08a` | `#4a3f17` | `#ffe600` | `#4a3f12` | `#f2d58a` | `#463e1c` |
| `--c-on-badge` | `#1b1d21` | `#ffe7a3` | `#2a1f1c` | `#ffec8f` | `#1d2a24` | `#f6e3a8` |
| `--c-earth` | `#54452f` | `#dcc8aa` | `#5e3f2a` | `#e2cfb6` | `#5c3e22` | `#dfc6a0` |
| `--c-meta` | `#454a52` | `#bcc1ca` | `#5e3f2a` | `#e2cfb6` | `#5c3e22` | `#dfc6a0` |
| `--c-shadow` | `#141e32` | `#000000` | `#2a1f1c` | `#000000` | `#28495f` | `#000000` |
| `--c-warn` | `#853d00` | `#ffb066` | `#7a4300` | `#ffc978` | `#6e4300` | `#f2c46d` |
| `--c-warn-bg` | `#fdf0dc` | `#33250f` | `#fff1d6` | `#3a2a12` | `#f7e8c4` | `#2e2614` |
| `--c-alert` | `#972019` | `#ff8d83` | `#971e18` | `#ff9a8f` | `#7a2a1f` | `#f09a84` |
| `--c-alert-bg` | `#fce8e6` | `#3a1a18` | `#fde7e4` | `#3a1a18` | `#f8e3dc` | `#2e1b17` |
| `--c-ok` | `#175c30` | `#7dd69a` | `#175c30` | `#7dd69a` | `#1f4d38` | `#8cc7a1` |
| `--c-ok-bg` | `#e4f4ea` | `#16291f` | `#e3f4e8` | `#18301f` | `#ddebdd` | `#16291f` |
| `--c-info` | `#1d4e9a` | `#9cc2ff` | `#1f3a5f` | `#b9d3f0` | `#1f4a66` | `#9cc9e3` |
| `--c-info-bg` | `#e8f0fc` | `#17233a` | `#eef3f8` | `#1c2633` | `#e4eef2` | `#16262e` |
| `--bw` | `1.5px` | `(상속)` | `2px` | `2px` | `1.5px` | `(상속)` |
| `--shadow` | `0 1px 3px rgba(20, 30, 50, 0.12)` | `none` | `none` | `none` | `0 2px 10px rgba(40, 73, 95, 0.14)` | `none` |

- 카드 규칙(모든 테마 공통): 안 눌리는 카드는 `--c-line` 테두리만(그림자 없음). 눌리는 카드(`a.card`, `.card:has(> a)`)는 `--c-border` 테두리 + 화살표(+ 크레용만 `--lift`). 선택된 줄·칩은 바깥 링 없이 테두리 자체를 강조색 3px(크레용은 강조색 손그림 선) + 점/체크 + 굵은 글씨 + 중간 톤 면.
- 기본 모양: 기본·숲 `--bw` 1.5px(선명하게 보기에서는 2px), `--shadow` 라이트 `0 1px 3px rgba(20,30,50,.12)`·다크 `none`. 크레용 `--bw` 2px, `--lift`(오프셋 그림자, 누르는 것 전용) 라이트 `2px 2px 0`·다크 `none`, 카드 띠 `--band` 라이트 10px·다크 6px. 숲 `--shadow` 라이트 `0 2px 10px rgba(40,73,95,.14)`·다크 `none`.
- 크레용 다크 추가: `--c-hl #5b2f39`, `--c-on-hl #ffd9df`, `--c-band-sky #3d6f8c`, `--c-deco-2 #8a4b58`, `--c-deco-3 #8a7524`, 손그림 외곽선 SVG 색 `#9b8c80`(선 굵기 2.4, 라이트 2.6).
- 숲 다크: `--tex-bg` 워시 알파를 줄였고(.35 / .2), 종이 결 opacity 와 수채 번짐 알파도 낮췄다(§6-4).

### 6-2. 상태 속성

| 속성 | 값 | 정하는 곳 | 저장 키 |
|---|---|---|---|
| `<html data-theme>` | crayon / forest (기본은 속성 없음) | `src/lib/theme.ts` | `yj.theme` |
| `<html data-scheme>` | light / dark (항상 설정됨) | `src/lib/scheme.ts` — 선택값 system 이면 matchMedia 로 해석하고 변화를 따라감 | `yj.scheme` (system·light·dark, 기본 system) |
| `<html data-contrast>` | high (꺼짐은 속성 없음) | `src/lib/highContrast.ts` | `yj.contrast` (normal·high) |

- 다크 토큰은 `:root[data-scheme="dark"]`(테마: `:root[data-theme="x"][data-scheme="dark"]`) 에만 둔다. `prefers-color-scheme` 미디어쿼리는 토큰·테마 CSS 에 쓰지 않는다(테스트가 확인).
- `theme-color` meta 는 두 줄 모두 같은 색(현재 테마 × 현재 밝기, 선명하게 보기면 `#ffffff`/`#0b0b0c`)으로 맞춘다.
- 세 init(`initTheme`, `initScheme`, `initContrast`)은 `main.tsx` 에서 첫 렌더 전에 부른다.
- 설정(S90)과 디자인 미리보기(S91)에 「화면 밝기」(시스템에 맞춤·밝게·어둡게) 라디오와 「선명하게 보기」 스위치(둘 다 48px 이상)를 둬서 6조합을 미리 볼 수 있다. 헤더 설정 단추는 막대 아이콘 + 「설정」 글자.

### 6-3. 선명하게 보기 (`src/styles/contrast-high.css`)

어느 테마·밝기 위에도 얹힌다(테마 CSS 뒤에 불러옴). 라이트: bg·surface `#ffffff`, surface-2 `#eef0f3`, fg `#000000`, muted `#2b2b2b`, border `#1a1a1a`, line `#6b6b6b`. 다크: bg `#0b0b0c`, surface `#161618`, surface-2 `#222226`, fg `#ffffff`, muted `#d9d9d9`, border `#e6e6e6`, line `#8c8c92`. 강조색은 테마별(라이트 기본 `#0a3d91`/크레용 `#004d7a`/숲 `#1b5a3d`, 다크 `#b3d0ff`/`#a6dcff`/`#a9e0bb`). `--bw` 2px, 질감·워시·오프셋 그림자·카드 띠·장식 SVG·애니메이션 끔, 크레용 손그림 외곽선은 곧은 단색 테두리로, 포커스 링 3px(띄움 3px).

### 6-4. 명세 값에서 바꾼 것 (게이트를 넘기려고 같은 색상에서 명도만 조정)

| 토큰 | 명세 | 적용 | 이유 |
|---|---|---|---|
| 기본 라이트 `--c-link` | `#1553b8` | `#134aa5` | surface-2 위 5.47:1 (링크 7:1 게이트). `--c-accent` 는 명세 그대로 |
| 크레용 라이트 `--c-link` | `#04609e` | `#035083` | bg 6.50, surface-2 6.03 |
| 숲 라이트 `--c-link` | `#245a7a` | `#1c4965` | bg 6.62, surface-2 6.06, 질감 최악 지점 6.7 |
| 기본 라이트 warn/alert/info/ok | `#a14a00`/`#b3261e`/`#1d4f9c`/`#1b6e3a` | `#853d00`/`#972019`/`#1d4e9a`/`#175c30` | 상태색은 -bg 위 7:1 |
| 기본 다크 alert | `#ff8a80` | `#ff8d83` | 같은 이유(6.86 → 7) |
| 크레용 라이트 alert/ok | `#a3201a`/`#1b6e3a` | `#971e18`/`#175c30` | 같은 이유 |
| 숲 라이트 warn | `#7a4a00` | `#6e4300` | 같은 이유 |
| 숲 다크 `--c-fg` | `#f6f0e1` | `#faf5e8` | surface-2 위 질감 최악 지점에서 12:1 |
| 숲 `--blob-alpha`/`-2` | .18/.1 (다크 .28/.2) | .04/.02 (다크 .03/.02) | 수채 번짐 위 fg 12:1 |
| 숲 종이 결 opacity | .055 (다크 .05) | .02 (다크 .02) | 같은 이유 |
| 숲 `--tex-bg` | 다크 알파 .5/.5 → 절반 | 다크 .35/.2, 라이트 초록 워시 .12 → .05 | 같은 이유 |

### 6-5. 참고

Material Design dark theme(표면 #121212 계열, 본문 15.8:1, 채도 낮은 강조색, 높을수록 밝은 면), Material 3 tone 기반 surface container, KRDS 색상·선명한 화면 모드(본문 약 15:1, 고도 단계, 색 외 단서), WCAG 2.2(1.4.3 · 1.4.6 AAA 7:1 · 1.4.11 비텍스트 3:1), 고령자 모바일 지침(PMC 2021: 높은 대비, 누르는 것과 아닌 것의 분명한 경계, 모호한 아이콘 피하기).

### 6-6. 2차 개선 (T-D1-7~, 독립 검토 8.2/10 반영)

- `--c-line` 을 카드 가장자리로 올렸다(바탕·면 위 3:1). 옛 옅은 값은 새 `--c-divider` 로 옮겨 목록 줄·헤더·탭바 선에 쓴다. 다크 면 단계를 키웠다(기본 `#1f2228`/`#2a2e35`, 크레용 `#2b2421`/`#372e2a`, 숲 `#1f2e2a`/`#233430`).
- 값 조정(본문 12:1 유지): 크레용 다크 `--c-fg` `#f8f2e9`→`#fffaf0`, 숲 다크 `--c-fg` `#faf5e8`→`#fffbef`, 숲 다크 surface-2 `#283a35`(제안)→`#233430`, 숲 다크 수채 번짐 알파 .015/.01. 크레용 라이트 `--c-accent-soft` `#ffe600`→`#fff1a8`(노랑 `#ffe600` 은 배지·형광펜에만).
- 선명하게 보기: 테마별 accent-soft(`#dfe6f5`/`#2e3340` 기본, `#dcedf8`/`#24343f` 크레용, `#dcece1`/`#24382f` 숲), 꺼진 단추는 opacity 없이 점선 + 보조 글자색, `--bw` 2px.
- 「선명하게 보기」는 라디오 줄과 같은 모양의 진짜 스위치(트랙·손잡이, 「켜짐/꺼짐」 글자, `role="switch"` + `aria-checked`). 설정·미리보기 순서: 화면 테마 → 화면 밝기 → 선명하게 보기.
- `html { scroll-padding-bottom }` 로 따라오는(sticky) 탭바에 가려지지 않게 한다.

### 6-7. 3차 개선 (T-D1-11~)

- 눌리는 카드(`a.card`, `.card:has(> a)`)는 테두리 2px `--c-border` + 화살표 + 약한 들림 그림자(기본·숲: `--c-shadow` 22%, 크레용: `--lift`), 안 눌리는 카드는 1.5px `--c-line`·그림자 없음. 크레용은 눌리는 카드만 손그림 선(3px). 모든 테마에서 눌리는 카드가 더 굵다는 것을 `e2e/theme.spec.ts` 가 계산된 스타일로 확인한다.
- 선명하게 보기에서 고른 줄·칩은 손그림 선(`border-image`) 없이 강조색 3px 곧은 테두리(크레용 회귀 수정). `e2e/a11y.spec.ts` 가 6조합에서 `border-image-source: none`, 두께 ≥ 3px, 색 = `--c-accent` 를 확인한다.
- 스위치는 공용 `SettingSwitch`(큰 글씨·선명하게 보기): 최소 높이 64px, 도움말은 `--c-muted`, 켜짐/꺼짐 글자는 트랙 아래에 쌓는다. 설정·미리보기 모두 화면 테마 → 화면 밝기 → 「글자·선명도」 순서.
- 꺼진 `.btn`/`.btn-primary` 는 모든 모드에서 opacity 없이 점선 테두리 + `--c-muted` 글자. 크레용 라이트 `--c-badge` `#ffe600`→`#ffe27a`(`--c-accent-soft` `#fff1a8` 과 구분).
- 설정 화면 스크린샷은 전체 페이지.

### 6-8. 4차 수정 (T-D1-14~)

- 회귀 수정: 스위치 트랙이 `.switch-ctl` 안으로 들어가 켜짐 선택자가 안 맞던 문제를 `.switch-row input:checked ~ .switch-ctl .switch-track` 으로 고쳤다. `e2e/theme.spec.ts` 가 3테마 × 라이트/다크 × (일반, 선명하게 보기)에서 켜짐 = 트랙 강조색 + 손잡이 오른쪽, 꺼짐 = 그 반대를 확인한다.
- 다크에서 눌리는 카드는 `--c-surface-2` 면 + 2px `--c-border`, 안 눌리는 카드는 `--c-surface` + 1.5px `--c-line`(e2e 가 면 색 차이도 확인). 기본·숲 다크 `--lift` 는 `none`.
- 선명하게 보기의 꺼진 단추 글자는 새 `--c-disabled`(라이트 `#4a4a4a`, 다크 `#b8b8b8`, 면 위 ≥ 7:1; 본문 보조색 `--c-muted` 10:1 보다 일부러 약하게) + 점선.
- 크레용 다크 `--c-accent` `#93d1fb`→`#7cc3f2`(손그림 선택 선 색도 같이). `--c-link` 는 `#93d1fb` 유지.

### 6-9. 5차 수정: 스냅샷 민감도 (T-D1-17~)

- 전체 화면 스냅샷 비교를 비율(`maxDiffPixelRatio` 0.002 ≈ 긴 화면에서 9천 픽셀)에서 절대값 `maxDiffPixels: 500`(+ `threshold` 0.05)으로 바꿨다. 긴 미리보기 화면에서 스위치 켜짐 회귀가 비율 허용치에 묻혀 기준 PNG 가 낡아 있었기 때문이다. 요소 스냅샷은 `threshold` 0.02, `maxDiffPixels` 100.
- 스위치 줄 요소 스냅샷(`el-switch-on|off-<테마>-<scheme>[-high].png`, 3테마 × 라이트/다크 × (일반, 선명하게 보기))을 추가했다. 켜짐 모양이 깨지면 해당 요소가 수천 픽셀 달라져 바로 실패한다.
- 크레용: 카드 위 색 띠는 눌리는 카드에만, 카드 안 `h2` 는 형광펜 없이 굵은 본문 글꼴(형광펜은 화면 단위 섹션 제목에만).
