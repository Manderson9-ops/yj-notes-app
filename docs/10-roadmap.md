# 10. 로드맵·작업 카드

## 1. 역할

| 역할 | 담당 | 하는 일 |
|---|---|---|
| 설계·검토 | Opus (설계 담당 에이전트) | 설계 문서, 작업 카드, PR 검토·병합, 보안 경계 판단 |
| 구현 | **Sonnet 5.5** (코딩 에이전트) | 작업 카드 단위 구현·테스트·PR |
| 결정·승인 | 관리자(아빠) | 결정 목록 D-xx, 비밀값 등록, 운영 자료 적재, 배포 승인 |

## 2. 마일스톤

| M | 목표 | 산출 | 완료 조건 |
|---|---|---|---|
| **M0** | 설계 | docs/, AGENTS.md, 저장소 골격 | 이 문서 승인 ✅ |
| **M1** | 기반·보안 | 빌드·CI·가드·D1 스키마·PIN 세션 | Q-SEC·Q-GUARD·Q-TYPE 녹색, 빈 앱 PIN 로그인 |
| **M2** | 가족 기록 | F2 + 오프라인 | E2E 흐름 2·3 통과 |
| **M3** | 알림장 + 적재 CLI | F4 + `tools/ingest`(fixtures) | E2E 4, Q-INGEST |
| **M4** | 보고서·검진·실적재 | F1·F3, production 적재 1회 | 원격 건수 = 원본, 관리자 검수 |
| **M5** | 검수·전환 | 조부모 사용 테스트, Lighthouse·axe, 현행 사이트 전환 | 품질 점수 ≥ 9.5(`08` §6), INC-01 종료 |
| M6 | 자동 갱신 v2 | Aside 주간 루틴 | 3주 연속 무인 성공 |

## 3. 작업 카드 (M1~M3, 순서대로)

카드 형식: **목표 / 입력 문서 / 산출 파일 / 수용 기준 / 모델**. GitHub Issue 로 옮겨 관리한다.

### M1
| ID | 목표 | 산출 | 수용 기준 | 모델 |
|---|---|---|---|---|
| T-01 | 프로젝트 골격 (Dependabot npm 항목은 이때부터 정상 동작) | package.json, tsconfig(strict), vite, eslint/prettier, vitest, playwright 설정, `src/` 빈 앱 | `npm ci && npm run check` 통과, Node 22 LTS 고정(.nvmrc) | Sonnet |
| T-02 | 유출 방지 가드 | `tools/guard/` (Node 스크립트), husky pre-commit, `npm run guard` | `04` §5 표의 검사 전부 + 위반 예시 테스트 10건(음성대조) | Sonnet |
| T-03 | CI | `.github/workflows/ci.yml` | Q-TYPE·LINT·UNIT·GUARD·gitleaks 실행, PR 필수 체크 | Sonnet |
| T-04 | D1 스키마 | `migrations/0001_init.sql`, `npm run db:migrate:local` | `03` §2 와 1:1, 로컬 적용 성공, fixture 시드 | Sonnet |
| T-05 | 보안 미들웨어 | `functions/_middleware.ts`, `server/http/headers.ts` | `04` §4 헤더 전부, `/api/*` 세션 확인, Origin 확인 | Sonnet → **Opus 검토 필수** |
| T-06 | PIN·세션 | `server/auth/*`, `/api/session`, `npm run pin:hash` | `04` §3 전부, 잠금(IP·전역), epoch 무효화, 커버리지 ≥95% | Sonnet → **Opus 검토 필수** |
| T-07 | Q-SEC 스크립트 | `tests/security/route-guard.test.ts` | 라우트 목록을 Hono 앱에서 자동 수집해 무세션 호출 → 401 | Sonnet |
| T-08 | 배포 파이프라인 | `.github/workflows/deploy.yml`, `wrangler.toml` | main 병합 시 Pages 배포, 토큰 최소 권한, Q-BUNDLE 통과 후에만 | Sonnet |
| T-09 | 앱 셸·PIN 화면 | `src/app`, S00, 하단 탭, 토큰 CSS | 360px 스크린샷, axe 0 | Sonnet |

### M2
| ID | 목표 | 산출 | 수용 기준 | 모델 |
|---|---|---|---|---|
| T-10 | 기록 종류 정의 | `log_type` 시드 4종(`03` §3) + zod 동적 검증 | 잘못된 값 422, 경고 규칙 데이터화 | Sonnet |
| T-11 | 기록 API | `PUT/GET/DELETE /api/logs`, `/logs/summary` | 멱등 PUT, 소프트 삭제, 요약 = 엑셀 기록표 지표와 같은 값(fixture 대조) | Sonnet |
| T-12 | 기록 입력 화면 | S20 | 30초 흐름(E2E 2), 큰 칩, 기본 기록자 기억 | Sonnet |
| T-13 | 오프라인 대기열 | SW + IndexedDB | E2E 3: 중복 0, 재시도 백오프 | Sonnet |
| T-14 | 기록 요약 화면 | S21 | 주차 비교·교차표·경고 → 가이드 링크 | Sonnet |

### M3
| ID | 목표 | 산출 | 수용 기준 | 모델 |
|---|---|---|---|---|
| T-20 | 합성 fixture 확장 | `fixtures/` 알림장 30일 등(`08` §3) | 실제 자료와 문장 일치 0 — 로컬 가드의 "실제 문장 대조"(`04` §5) 통과 로그를 PR 에 첨부(CI 에는 자료가 없어 불가) | Sonnet |
| T-21 | ingest export/verify | `tools/ingest/` Python(requirements.txt — Dependabot pip 대상), pytest | 결정적 출력, I1~I6, fixture DATA_DIR 로 테스트 | Sonnet → Opus 검토 |
| T-22 | ingest upload/status | wrangler 호출, 테이블 화이트리스트 | `family_log` 절대 미변경 테스트, 실패 시 status=failed | Sonnet → Opus 검토 |
| T-23 | 알림장 API·화면 | `/api/notes*`, S30·S31 | 검색 1초 이내(fixture 500일 부하), E2E 4 | Sonnet |
| T-24 | 홈 대시보드 | `/api/overview`, S10 | 모든 숫자 쿼리 기반(P3) — 하드코딩 숫자 검출 테스트 | Sonnet |

M4~M5 카드는 M3 종료 시 작성한다(실제 자료 적재 결과를 보고 확정).

## 4. 결정 목록

| ID | 결정 | 상태 | 날짜 |
|---|---|---|---|
| D-01 | 저장소 공개 + 자료 분리 | **확정** | 2026-09-28 |
| D-02 | 접속 보호는 PIN 유지 (서버 검증으로 구현). 생일 아닌 6자리 이상 권고 | 확정 / 권고 대기 | 2026-09-28 |
| D-03 | 현행 사이트는 신규 앱 완성까지 유지(INC-01 위험 수용) | 확정 | 2026-09-28 |
| D-04 | 저장소 라이선스 (MIT / 비공개 저작권 유지) | **대기** | — |
| D-05 | 알림장 검색 FTS5 trigram 도입 | M3 스파이크 후 | — |
| D-06 | 키즈노트 주간 자동 수집(v2) — 약관 확인 포함 | M5 후 | — |
| D-07 | 1차 범위 = F0~F5 전체 | 확정 | 2026-09-28 |

## 5. 위험

| 위험 | 가능성 | 영향 | 대응 |
|---|---|---|---|
| 공개 저장소로 자료 유출 | 중 | 매우 큼 | 가드 3중(pre-commit·CI·리뷰), fixture 규칙 |
| 키즈노트 API 변경·차단 | 중 | 중 | 수집 실패해도 앱은 기존 자료로 동작, 수집만 수정 |
| 무료 한도 정책 변경 | 낮 | 중 | 월간 사용량 점검 O-04, 데이터는 SQL 로 이식 가능 |
| 조부모 사용 어려움 | 중 | 중 | M5 사용 테스트, 큰 글씨 모드 |
| 4자리 PIN 추측 | 중 | 큼 | 시도 제한 + PIN 교체 권고 |
