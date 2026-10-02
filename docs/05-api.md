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
| GET | `/session` | — | `{authenticated: bool, pinLength?: 4~12}` — `pinLength` 는 서버 `PIN_LENGTH` 가 유효할 때만, 세션 유무와 무관하게 포함(로그인 화면이 점 개수·자동 전송 시점에 사용). 없으면 클라이언트는 4~12자리 + '확인' 방식 |
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

| GET | `/reports` | `{items:[{slug, title, kind, group, generatedAt, sourceCommit, verifyOk}]}` 최신순. `group` = `report`/`guide`/`wiki`(slug 규칙, docs/03). 본문 없음 |
| GET | `/reports/:slug` | 메타 + `rawPath`. 형식이 틀리거나 없으면 `404 not_found` |
| GET | `/reports/:slug/raw` | 마크다운: `text/markdown` 원문(기본 CSP). HTML: `text/html` + 보고서 전용 CSP(`reportCsp`), `sandbox="allow-scripts"` iframe 으로만 연다. 본문은 `report_doc.body`, 없으면 R2(`FILES`), 둘 다 없으면 `404` |

## 검진·성장 (F3)

| GET | `/checkups` | `{items:[{id, roundLabel, examDate, ageMonths, overall, remarks, devResult, imageUrl, measurements:[{id, measure, measuredOn, value, sheetPct, readStatus, note}]}]}` 최신순. 결과지 문구·백분위는 원본 그대로(판정 문구 생성 금지). 검진에 속하지 않은 가정 측정값은 제외. `imageUrl` 은 사진 지원 전까지 항상 `null` |
| GET | `/checkups/:id` | 위 항목 1건. 없으면 `404` |
| GET | `/growth?measure=height_cm\|weight_kg\|head_cm\|bmi` | `{measure, sex, referenceSource, points:[{id, date, ageMonths, value, sheetPct, recalcPct, readStatus, note, fromCheckup}], reference:[{ageMonth, p3, p50, p97}]}`. `ageMonths` = `app_setting.child_birth_date` 기준 만 개월(없으면 검진 회차의 개월 수, 그것도 없으면 `null`). `sheetPct` 는 결과지 값 그대로, `recalcPct` 는 기준표 L/M/S 로 다시 계산한 참고값(그 개월 행에 LMS 가 있을 때만, 아니면 `null`). 다른 `measure` 는 `400` |
| GET | `/files/*` | R2 객체 스트리밍(허용 접두어 `s2/checkup/` 만, 그 밖은 `404`). R2(`FILES`) 바인딩이 없는 동안(M4 전)은 `501 not_implemented` |

## 가족 기록 (F2)

질문·선택지·경고 규칙은 `log_type.schema_json` 데이터가 정본이다(`03` §3). 서버(`server/logs/definition.ts`)가 그 정의로 입력을 검증하고 경고를 계산한다. 코드 배포 없이 종류를 더할 수 있다.

| 메서드 | 경로 | 요청/응답 |
|---|---|---|
| GET | `/log-types` | 사용 중인 종류만. `[{code, label, schema:{fields:[…], alerts:[{field,op,value,guide,message_ko?}], summary?:{highlight?, crosstabs?}}}]` |
| GET | `/logs` | `type`, `from`, `to`, `limit`(1~500, 기본 200) → `{items:[{id,type,occurredOn,recorder,payload,note,createdAt,updatedAt,deviceId,alerts}]}` (삭제 제외, `occurredOn` 내림차순). 날짜 형식이 틀리면 `422` |
| GET | `/logs/:id` | `{item}` / `404`(없음·삭제됨) — 수정 화면용 |
| PUT | `/logs/:id` | 생성·수정 겸용(**멱등**, id=클라이언트 UUIDv7). 요청 `{type, occurredOn, recorder, payload, note?, deviceId}` → `200 {item, alerts:[{field,message,guide}], week:{start,end,count}}` / `422 validation_error {fields}` / `409 deleted`(지운 기록에 다시 보냄) |
| DELETE | `/logs/:id` | 소프트 삭제 → `204`(이미 지웠어도 `204`, 없으면 `404`) |
| GET | `/logs/summary` | `type`, `from`, `to` → 아래 정의 |

**PUT 규칙**
- 같은 id 로 같은 내용을 다시 보내면 행·`updated_at`·이력이 그대로다(오프라인 재전송 안전). 내용이 다르면 갱신하고 이전 모습을 `family_log_history` 에 남긴다. 삭제도 이력을 남긴다.
- `type` 은 한 번 정하면 바꿀 수 없다(`422`). `payload` 는 정의에 있는 키만, 필수 키는 모두(`enum` 은 선택지 안, `int` 는 정수·범위 안, `text` 는 길이 안).
- `422` 의 `fields` 는 `{"payload.came":"목록에서 골라 주세요."}` 모양(키 = 필드 경로, 값 = 한국어 이유). 응답에 입력값은 넣지 않는다.
- `week` 는 `occurredOn` 이 속한 월~일 주에서 그 종류의 (삭제 제외) 기록 수다. 화면은 "이번 주 3번째 기록" 같은 사실만 보여 준다.
- 경고 `alerts` 는 정의의 규칙(`op`: `>= > <= < == !=`)에 걸린 것만. `guide` 는 가이드 경로(`guide/05#3-1`)이고 화면은 `/library/<guide>` 로 연결한다.

**`/logs/summary` 지표 정의** (기존 엑셀 기록표와 같은 정의, 숫자는 전부 기록에서 센다 — P3)
- 구간: `from`~`to`(없으면 가장 이른·늦은 기록일). 주차 = `from` 부터 7일씩 끊은 구간(1주차 = `from`~`from+6일`), 최대 53주.
- 주차별: `count`, 그리고 `type` 을 지정하면 `summary.highlight`(없으면 enum·int 전부) 필드마다 — enum: 값별 개수 `{kind:"enum",counts}`, int: `{kind:"int",n,sum,avg(소수 첫째 자리),max}`.
- 교차표: `summary.crosstabs` 의 (행 필드 × 열 필드) 개수. 저녁 식사는 식전 간식 × 먹은 양. 선택지 순서는 정의 순서.
- 경고: 정의의 규칙에 걸린 (기록, 규칙) 쌍의 목록(최신순)과 `alertCount`.
- `type` 을 생략하면 주차별 `count`·경고만(종류가 섞이므로 필드 지표 없음).
- 검증: `server/routes/logs.test.ts` 가 `fixtures/seed` 합성 기록(저녁 식사 5건)을 손으로 센 값과 대조한다.

## 관리

관리 기능(적재·세션 무효화)은 **웹 API 로 노출하지 않는다.** 관리자 PC 의 `tools/ingest` 가 wrangler 로 D1 에 직접 실행한다(공격 표면 축소).

## 한도 대응
- D1 일일 한도 초과 시 D1 이 오류를 낸다 → API 는 `503 {"error":"quota_exceeded"}` 와 "내일 오전 9시(KST) 이후 다시" 안내.
