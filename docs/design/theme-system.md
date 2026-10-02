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
| 색 | `--c-deco-1`, `--c-deco-2`, `--c-deco-3` | 장식 SVG 전용(글자 금지, 대비 기준 밖) |
| 색 | `--c-warn`, `--c-alert`, `--c-ok`, `--c-info` + 각 `-bg` | 상태 배지(판정 아님, 상태 표시만) |
| 글꼴 | `--font-body`, `--font-display` | 본문 / 정적 UI 문구 |
| 크기 | `--fs-base`, `--fs-lg`, `--fs-xl`, `--lh-base` | 큰 글씨 설정이 덮어씀 |
| 모양 | `--radius`, `--radius-lg`, `--bw`(경계 두께), `--shadow`, `--shadow-press` | 카드·버튼 |
| 질감 | `--tex-bg`, `--tex-surface` | 배경 그림(`none` 허용). 글자 뒤에는 대비를 깎지 않는 옅은 질감만 |
| 동작 | `--ease`, `--dur` | 전환. `prefers-reduced-motion` 에서 0 |
| 간격 | `--tap`, `--space-1…6` | 테마 무관(바꾸지 않음) |

## 3. 지켜야 할 기준 (테마 공통 하드 게이트)

| ID | 기준 | 확인 방법 |
|---|---|---|
| TH-1 | 6 조합 모두 본문 대비 ≥ 4.5:1 (`fg/bg`, `fg/surface`, `muted/bg`, `on-accent/accent`, 상태색/상태 바탕) | `src/styles/contrast.test.ts` 가 CSS 를 읽어 계산 |
| TH-2 | UI 경계·포커스 링 대비 ≥ 3:1 | 같은 테스트 |
| TH-3 | axe serious/critical 0 (6 조합 × PIN·홈·설정·미리보기) | `e2e/a11y.spec.ts` |
| TH-4 | 터치 영역 ≥ 48px, 큰 글씨 설정 유지 | e2e + 스크린샷 |
| TH-5 | `prefers-reduced-motion` 에서 움직임 0 | CSS 규칙 + e2e |
| TH-6 | 기본 테마 번들 증가 ≤ 15 KB gzip(JS+CSS), 폰트는 테마별 ≤ 80 KB, 기본 테마에선 폰트 요청 0 | build 출력 + e2e 네트워크 확인 |
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
| 스크린샷 갱신 | `npm run test:e2e` 가 `e2e/__screenshots__/<화면>-<테마>-<light|dark>.png` 로 저장 |

## 5. 저작권·상표 체크리스트 (PR 마다)

- [ ] 캐릭터(사람·동물·괴물)를 그리지 않았다. 사람 형태는 쓰지 않는다.
- [ ] 작품 로고·제목 글자·효과음 글자·대사를 흉내 내지 않았다.
- [ ] 외부 이미지 파일·스크린샷을 넣지 않았다. 모든 장식은 직접 그린 SVG 다.
- [ ] 화면 문구에 작품명·회사명이 없다(「크레용」「숲」만).
- [ ] 폰트는 OFL 등 재배포 가능 라이선스이고 `public/fonts/LICENSES.md` 에 적었다.
