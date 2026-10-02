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

| GET | `/overview` | 아래 「/overview 응답」 — 모든 숫자는 쿼리로(P3). 자료가 없으면 0·빈 배열·`null`(오류 아님) |

### /overview 응답 (T-C1 구현, 정본 `src/lib/notesSchemas.ts` `overviewSchema`)

```
{ noteDays, reports, comments,
  range: {from,to} | null,                       // 알림장 날짜 범위
  lastIngest: {at, status:'ok', commit} | null,  // 마지막 성공 적재(finished_at, 없으면 started_at)
  milestones: {observed, unobserved},            // observation 에 나온 이정표 수 / 나머지
  recentNotes: [{date, ageMonths, firstLine, nComments}] ×3,   // 홈 카드용(문서 초안에 없던 필드)
  recentLogs: [{id, type, typeLabel, occurredOn, recorder, note}] ×5  // family_log, 삭제 제외
}
```

- 초안과 다른 점: `undetectable` 은 스키마에 근거 열이 없어 뺐다(꾸며낸 숫자 방지). `comments`·`recentNotes` 를 더했다.

## 알림장 (F4)

| 메서드 | 경로 | 파라미터 | 응답 |
|---|---|---|---|
| GET | `/notes` | `q`(≤40자), `from`, `to`, `class`, `cursor`, `limit`(기본 20, ≤50) | `{items:[{date, class, ageMonths, nReports, nComments, firstLine, hit?}], nextCursor}` |
| GET | `/notes/:date` | — | `{date, class, ageMonths, items:[{reportId, authorRole, direction, weather, postedAt, body, comments:[{id, who, postedAt, body}]}], prev, next}` |

구현 메모 (T-C1, 정본 `src/lib/notesSchemas.ts`):
- 목록은 날짜 내림차순. `cursor` 는 직전 페이지 마지막 `date`(그보다 오래된 날부터). `nextCursor` 가 `null` 이면 끝.
- `q`: 본문과 댓글에서 부분 일치(D1 `LIKE ... ESCAPE '\'`, `%` `_` `\` 는 글자 그대로). 대소문자는 ASCII 만 무시. FTS5 는 D-05 스파이크 뒤로 미룸. 500일 합성 자료에서 검색 3회 합계 10ms 안팎(node:sqlite; 한도 1초는 테스트로 고정).
- `hit`: `{source:'body'|'comment', text, ranges:[[start,end]], cutStart, cutEnd}` — `text` 는 일치 주변 발췌(앞 24자·뒤 48자), `ranges` 는 `text` 안의 일치 구간(UTF-16 코드 단위), `cutStart/cutEnd` 는 앞뒤가 잘렸는지. 본문 일치가 있으면 본문, 없으면 댓글.
- 상세 `prev`(더 오래된 날)·`next`(더 최근 날)는 `note_day` 기준, 없으면 `null`. `ageMonths` 는 `note_day.age_months`(생일 설정 불필요, 마이그레이션 없음).
- 초안과 다른 점: `sourceUrls` 는 저장된 값이 없어 뺐다. `direction`·`weather`·댓글 `who`(parent/teacher)를 응답에 포함. 잘못된 쿼리·날짜는 `400 bad_request`, 없는 날은 `404 not_found`.

## 보고서·문서 (F1)

| GET | `/reports` | 목록 `{slug, title, kind, generatedAt, sourceCommit, verifyOk}` |
| GET | `/reports/:slug` | 메타 |
| GET | `/reports/:slug/raw` | HTML(sandbox iframe 용, 별도 CSP) 또는 마크다운 원문 |

## 검진·성장 (F3)

| GET | `/checkups` | 검진 목록 |
| GET | `/checkups/:id` | 상세 + 계측 + `imageUrl`(세션 필요, `/api/files/s2/...`) |
| GET | `/growth?measure=height_cm` | `{points:[{date, ageMonths, value, sheetPct, recalcPct, readStatus, note}], reference:{p3,p50,p97…}[]}` |
| GET | `/files/*` | R2 객체 스트리밍(허용 접두어 `s2/checkup/` 만) |

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
