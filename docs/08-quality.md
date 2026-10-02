# 08. 품질

## 1. 품질 게이트 (CI 에서 실패하면 병합 불가)

| ID | 게이트 | 도구 | 기준 |
|---|---|---|---|
| Q-TYPE | 타입 | `tsc --noEmit` (strict) | 오류 0 |
| Q-LINT | 린트·포맷 | ESLint + Prettier, ruff(Python) | 오류 0 |
| Q-UNIT | 단위 | Vitest | 통과, `server/` 줄 커버리지 ≥ 85%, `server/auth` ≥ 95% |
| Q-API | API 통합 | vitest-pool-workers(Miniflare D1/R2) + fixtures | 통과 |
| Q-SEC | 인증 경계 | 자동 스크립트: 세션 없이 **모든** 라우트 호출 | `/api/health`·`/api/session` 외 전부 401 |
| Q-CSP | 헤더 | 통합 테스트 | §04-4 헤더 전부 존재 |
| Q-GUARD | 유출 방지 | `tools/guard` + gitleaks | 위반 0 |
| Q-BUNDLE | 빌드물 | `dist/` 검사 | fixture 외 한글 장문·S1 표지어 0, 소스맵 미배포 |
| Q-E2E | 종단 | Playwright(모바일 360px, Chromium·WebKit) | 핵심 흐름 4개 통과 |
| Q-A11Y | 접근성 | axe-core(Playwright) | serious/critical 0 |
| Q-PERF | 성능 | Lighthouse CI(모바일) + `npm run size:check` | Performance ≥ 90, LCP ≤ 2.5s, **전체 JS ≤ 200KB gzip**(lazy 청크 포함), **초기 로드(index.html 이 부르는 JS+CSS) ≤ main 기준값 119.50KB + 20KB**, 폰트 파일당 ≤ 80KiB. 측정법·현재 수치: `docs/design/theme-system.md` §4 |
| Q-INGEST | 적재 | `tools/ingest verify` (fixtures 로) | I1~I7 통과 |

## 2. 핵심 E2E 흐름
1. PIN 실패 5회 → 잠금 표시 → 시간 경과 후 성공 → 홈
2. 저녁 식사 기록을 30초 안에 입력 → 목록·요약 반영 → 25분 경고 → 가이드 링크
3. 오프라인에서 기록 2건 → 온라인 복귀 → 자동 전송, 중복 없음(멱등)
4. 알림장 "기차" 검색 → 상세 → 다음 날 이동

## 3. 테스트 데이터
- `fixtures/` 합성 데이터만(`04` §5 규칙 R3): 알림장 30일, 댓글 40개, 이정표 10개, 검진 1건, 기록 각 종류 5건.
- 경계값 포함: 하루 2건 알림장, 댓글 0건, 빈 본문, 이모지, 아주 긴 본문(2MB 미만), UNCERTAIN 계측.

## 4. 완료 정의 (DoD) — 작업 카드 단위
- [ ] 수용 기준(카드에 명시) 전부 충족, 테스트로 증명
- [ ] Q-TYPE·Q-LINT·Q-UNIT·Q-GUARD 통과(로컬)
- [ ] 새 API 는 zod 스키마 + `05-api.md` 갱신
- [ ] 새 화면은 360px 스크린샷 첨부, 판정 어휘 없음(P1)
- [ ] 자료 등급 S1/S2 를 다루면 `04` 규칙 재확인 체크
- [ ] PR 설명에 "무엇을/왜/어떻게 검증했나"

## 5. 리뷰 규칙
- 코딩 에이전트(Sonnet)가 만든 PR 은 **설계 담당(Opus)이 검토** 후 병합한다(`AGENTS.md`).
- 보안 관련(`server/auth`, `functions/_middleware.ts`, `tools/guard`, `tools/ingest`) 변경은 보안 체크리스트(`04` §2 표) 대조를 PR 에 남긴다.

## 6. 품질 점수 기준 (자체 평가 10점 척도)
| 항목 | 배점 | 9.5 이상 조건 |
|---|---|---|
| 보안·개인정보 | 3 | Q-SEC·Q-GUARD·Q-BUNDLE 통과, 사고 대응 문서 최신 |
| 정확성 | 2 | Q-INGEST 통과, 화면 숫자 전부 쿼리 기반 |
| 사용성 | 2 | 30초 입력, Q-A11Y 통과, 조부모 사용 테스트 1회 |
| 신뢰성 | 1.5 | 오프라인·멱등·백업 복구 연습 1회 |
| 유지보수성 | 1.5 | 커버리지 기준, 문서-코드 일치, ADR 최신 |

## 7. 초기 번들 규칙 (Q-PERF 상세)
- 측정: `npm run build && npm run size:check`. 초기 로드 = `index.html` 이 부르는 JS+CSS(gzip). 한도 = main 기준값 119.50 KB + 20 KB = 139.50 KB. 현재 110.35 KB(여유 약 29 KB).
- **여유는 항상 5 KB 이상**: 한도까지 5 KB 미만이 되면 `size:check` 가 실패한다. 한도를 늘려서 통과시키지 않는다 — 초기 청크의 것을 `React.lazy` / `import()` 로 옮긴다.
- 첫 화면(PIN·앱 껍데기)이 정적으로 끌어와도 되는 것: React, 라우터, react-query, 디자인 토큰 CSS, PIN 화면, 하단 탭, 오프라인 배너 껍데기.
- 반드시 lazy 로 두는 것: zod(첫 화면은 `src/lib/schemas.ts` 의 손 검사만 쓴다), 화면 묶음(홈·알림장·자료·기록·설정·디자인 미리보기), 오프라인 대기열 동기화(`QueueSync`)와 대기열 코드(`src/lib/logs/queue.ts`), 로그 스키마, 배너의 건수 부분(`QueueBanners`).
- `src/app/entry-graph.test.ts` 가 `src/main.tsx` 에서 정적 import 로 닿는 파일을 따라가 위 규칙을 지켰는지 단위 시험으로 확인한다(실패하면 그 import 를 lazy 로).
- 새 화면 카드는 라우트를 `React.lazy` 로 등록하고, 그 화면만 쓰는 CSS 는 화면 파일에서 import 한다(지연 묶음에 실린다).
