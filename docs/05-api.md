# 05. API

- 기준: `https://<pages-domain>/api` · JSON(UTF-8) · 모든 응답 `Cache-Control: private, no-store`
- 인증: `/api/session`(POST/GET), `/api/health` 외 **전부 세션 필요**. 없으면 `401 {"error":"auth_required"}`
- 쓰기 요청: `Content-Type: application/json` 필수, `Origin` 이 자기 도메인이어야 함(아니면 `403`)
- 오류 형식: `{"error": "<code>", "message": "<사람이 읽는 한국어>"}` — 자료 내용·SQL·스택을 넣지 않는다
- 요청·응답 스키마는 `server/schemas/*.ts`(zod) 가 정본. 이 문서는 요약.

## 인증

| 메서드 | 경로 | 요청 | 응답 |
|---|---|---|---|
| POST | `/session` | `{pin}` | `204` + 쿠키 / `401 invalid_pin` / `429 locked {retryAfterSec}` |
| GET | `/session` | — | `{authenticated: bool}` |
| DELETE | `/session` | — | `204` (이 기기 로그아웃) |
| GET | `/health` | — | `{ok, version, lastIngestAt}` — 자료 없음 |

## 대시보드

| GET | `/overview` | `{noteDays, reports, range:{from,to}, lastIngest:{at,status,commit}, milestones:{observed,unobserved,undetectable}, recentLogs:[…5]}` — 모든 숫자는 쿼리로(P3) |

## 알림장 (F4)

| 메서드 | 경로 | 파라미터 | 응답 |
|---|---|---|---|
| GET | `/notes` | `q`(≤40자), `from`, `to`, `class`, `cursor`, `limit`(≤50) | `{items:[{date, class, nReports, nComments, firstLine, hit?}], nextCursor}` |
| GET | `/notes/:date` | — | `{date, class, ageMonths, items:[{reportId, authorRole, direction, postedAt, body, comments:[…]}], sourceUrls}` |

## 보고서·문서 (F1)

| GET | `/reports` | `{items:[{slug, title, kind, group, generatedAt, sourceCommit, verifyOk}]}` 최신순. `group` = `report`/`guide`/`wiki`(slug 규칙, docs/03). 본문 없음 |
| GET | `/reports/:slug` | 메타 + `rawPath`. 형식이 틀리거나 없으면 `404 not_found` |
| GET | `/reports/:slug/raw` | 마크다운: `text/markdown` 원문(기본 CSP). HTML: `text/html` + 보고서 전용 CSP(`reportCsp`), `sandbox="allow-scripts"` iframe 으로만 연다. 본문은 `report_doc.body`, 없으면 R2(`FILES`), 둘 다 없으면 `404` |

## 검진·성장 (F3)

| GET | `/checkups` | `{items:[{id, roundLabel, examDate, ageMonths, overall, remarks, devResult, imageUrl, measurements:[{id, measure, measuredOn, value, sheetPct, readStatus, note}]}]}` 최신순. 결과지 문구·백분위는 원본 그대로(판정 문구 생성 금지). 검진에 속하지 않은 가정 측정값은 제외. `imageUrl` 은 사진 지원 전까지 항상 `null` |
| GET | `/checkups/:id` | 위 항목 1건. 없으면 `404` |
| GET | `/growth?measure=height_cm\|weight_kg\|head_cm\|bmi` | `{measure, sex, referenceSource, points:[{id, date, ageMonths, value, sheetPct, recalcPct, readStatus, note, fromCheckup}], reference:[{ageMonth, p3, p50, p97}]}`. `ageMonths` = `app_setting.child_birth_date` 기준 만 개월(없으면 검진 회차의 개월 수, 그것도 없으면 `null`). `sheetPct` 는 결과지 값 그대로, `recalcPct` 는 기준표 L/M/S 로 다시 계산한 참고값(그 개월 행에 LMS 가 있을 때만, 아니면 `null`). 다른 `measure` 는 `400` |
| GET | `/files/*` | R2 객체 스트리밍(허용 접두어 `s2/checkup/` 만, 그 밖은 `404`). R2(`FILES`) 바인딩이 없는 동안(M4 전)은 `501 not_implemented` |

## 가족 기록 (F2)

| 메서드 | 경로 | 요청/응답 |
|---|---|---|
| GET | `/log-types` | `[{code, label, schema}]` |
| GET | `/logs` | `type`, `from`, `to` → `{items:[…]}` (삭제 제외) |
| PUT | `/logs/:id` | 생성·수정 겸용(멱등, id=클라이언트 UUIDv7) `{type, occurredOn, recorder, payload, note, deviceId}` → `200 {item}` / `422 validation_error {fields}` |
| DELETE | `/logs/:id` | 소프트 삭제 → `204` |
| GET | `/logs/summary` | `type`, `from`, `to` → 기록표와 같은 지표(주차 비교, 교차표, 경고 건수) |

## 관리

관리 기능(적재·세션 무효화)은 **웹 API 로 노출하지 않는다.** 관리자 PC 의 `tools/ingest` 가 wrangler 로 D1 에 직접 실행한다(공격 표면 축소).

## 한도 대응
- D1 일일 한도 초과 시 D1 이 오류를 낸다 → API 는 `503 {"error":"quota_exceeded"}` 와 "내일 오전 9시(KST) 이후 다시" 안내.
