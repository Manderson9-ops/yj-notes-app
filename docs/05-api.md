# 05. API

- 기준: `https://<pages-domain>/api` · JSON(UTF-8) · 모든 응답 `Cache-Control: private, no-store`
- 인증: `/api/session`(POST/GET), `/api/health` 외 **전부 세션 필요**. 없으면 `401 {"error":"auth_required"}`
- 쓰기 요청: `Content-Type: application/json` 필수, `Origin` 이 자기 도메인이어야 함(아니면 `403`)
- 오류 형식: `{"error": "<code>", "message": "<사람이 읽는 한국어>"}` — 자료 내용·SQL·스택을 넣지 않는다
- 요청·응답 스키마의 정본(zod, R1-10 에서 실제 위치로 정정): 응답 모양은 `src/lib/schemas.ts`(세션)·`src/lib/notesSchemas.ts`(알림장·overview)·`src/lib/logs/schemas.ts`(가족 기록)·`src/features/library/api.ts`(자료실), 서버 입력 검증은 각 `server/routes/*.ts` 와 `server/logs/definition.ts`. 이 문서는 요약.

## 인증

| 메서드 | 경로 | 요청 | 응답 |
|---|---|---|---|
| POST | `/session` | `{pin}` | `204` + 쿠키 / `401 invalid_pin` / `429 locked {retryAfterSec}` |
| GET | `/session` | — | `{authenticated: bool, pinLength?: 4~12}` — `pinLength` 는 서버 `PIN_LENGTH` 가 유효할 때만, 세션 유무와 무관하게 포함(로그인 화면이 점 개수·자동 전송 시점에 사용). 없으면 클라이언트는 4~12자리 + '확인' 방식 |
| DELETE | `/session` | — | `204` (이 기기 로그아웃) |
| GET | `/health` | — | `{ok, version, lastIngestAt, updating}` — 자료 없음. `updating` 은 최근 적재가 `running`(6시간 이내)일 때만 true(R1-6) |

## 대시보드

| GET | `/overview` | 아래 「/overview 응답」 — 모든 숫자는 쿼리로(P3). 자료가 없으면 0·빈 배열·`null`(오류 아님) |

### /overview 응답 (T-C1 구현, 정본 `src/lib/notesSchemas.ts` `overviewSchema`)

```
{ noteDays, reports, comments,
  range: {from,to} | null,                       // 알림장 날짜 범위
  lastIngest: {at, status:'ok', commit} | null,  // 마지막 성공 적재(finished_at, 없으면 started_at)
  ingestState: 'idle'|'running'|'failed',        // R1-6: 가장 최근 ingest_run 상태(running 6시간 초과는 failed 로 본다)
  security: {lastGlobalLockAt: string | null},   // R1-3: 마지막 전체 잠금(ISO UTC)
  ask: {pending, worker:{online, seenAt}, medianTotalMs7d},   // T-Q1: 답 기다리는 질문 수·워커 상태·7일 답 시간 중앙값(ms, 없으면 null)
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

| GET | `/reports` | `{items:[{slug, title, kind, group, generatedAt, sourceCommit, verifyOk}]}` 최신순. `group` = `report`/`guide`/`wiki`(slug 첫 마디 규칙, docs/03). 본문 없음 |
| GET | `/reports/:slug` | 메타 + `rawPath`. 형식이 틀리거나 없으면 `404 not_found` |
| GET | `/reports/:slug/raw` | 마크다운: `text/markdown` 원문(기본 CSP). HTML: `text/html` + 보고서 전용 CSP(`reportCsp`), `sandbox="allow-scripts"` iframe 으로만 연다. 본문은 `report_doc.body`, 없으면 R2(`FILES`), 둘 다 없으면 `404` |

## 검진·성장 (F3)

| GET | `/checkups` | `{items:[{id, roundLabel, examDate, ageMonths, overall, remarks, devResult, imageUrl, measurements:[{id, measure, measuredOn, value, sheetPct, readStatus, note}]}]}` 최신순. 결과지 문구·백분위는 원본 그대로(판정 문구 생성 금지). 검진에 속하지 않은 가정 측정값은 제외. `imageUrl` 은 사진 지원 전까지 항상 `null` |
| GET | `/checkups/:id` | 위 항목 1건. 없으면 `404` |
| GET | `/growth?measure=height_cm\|weight_kg\|head_cm\|bmi` | `{measure, sex, referenceSource, points:[{id, date, ageMonths, value, sheetPct, recalcPct, readStatus, note, fromCheckup}], reference:[{ageMonth, p3, p50, p97}]}`. `ageMonths` = `app_setting.child_birth_date` 기준 만 개월(없으면 검진 회차의 개월 수, 그것도 없으면 `null`). `sheetPct` 는 결과지 값 그대로, `recalcPct` 는 기준표 L/M/S 로 다시 계산한 참고값(그 개월 행에 LMS 가 있을 때만, 아니면 `null`). 다른 `measure` 는 `400` |
| GET | `/files/*` | R2 객체 스트리밍(허용 접두어 `s2/checkup/` 만, 그 밖은 `404`). **Content-Type 허용 목록(R1-9)**: `image/jpeg`·`image/png`·`image/webp`·`application/pdf` 만 내보내고 그 밖(없음 포함)은 `415 unsupported_media_type`. 응답에 `Content-Disposition: inline; filename="<basename>"` 와 `nosniff`. R2(`FILES`) 바인딩이 없는 동안(M4 전)은 `501 not_implemented` |

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

## 물어보기 (T-Q1, `11`)

세션 API(가족). 정본: `server/routes/ask.ts`, 입력·답변 스키마 `shared/ask-schema.ts`, 화면용 응답 스키마 `src/lib/ask/api.ts`.

| 메서드 | 경로 | 요청/응답 |
|---|---|---|
| POST | `/ask` | `{body(1~1000자), askedBy(1~12자)}` → `201 {id, status:"pending", redFlag, instant:{notes:[{date,snippet,id}], docs:[{slug,title}]}}`. instant = 알림장 본문·자료 제목/요약의 `LIKE` 검색(각 최대 5, AI 없음). `redFlag` 는 결정적 키워드 검사. 같은 질문자가 10분 안 10건을 넘기면 `429 too_many`. `422` 검증 오류 |
| GET | `/ask?before=<id>` | 최신순 20개 `{items:[{id,askedBy,bodyPreview(80자),status,redFlag,level?,createdAt,votes:{up,down}}], nextBefore}` |
| GET | `/ask/:id` | `{question:{id,askedBy,body,createdAt}, status, redFlag, answer?:{level(not_behavior 답은 null), answer(AnswerSchema), createdAt, totalMs, reviewScore(0~10, 없으면 null)}, feedback:[{id,by,note,createdAt}](메모만), votes:[{by,helpful,reason,updatedAt}], history:[{version,level,createdAt,answer}](이전 답, 오래된 것부터. 최신 답은 `answer`), reask:{count,reason,by}}` / `404`(없음·삭제됨·번호 형식 오류). 화면이 5초마다 조회(완료·실패면 멈춤) |
| GET | `/ask/:id/instant` | `{notes, docs}` — 목록에서 연 질문의 즉시 결과 다시 보기(명세 보강: 폴링에 검색 쿼리를 싣지 않으려고 분리) |
| PUT | `/ask/:id/vote` | `{by, helpful: true|false|null, reason?(≤200, 👎 일 때만)}` → `200 {votes:[{by,helpful,reason,updatedAt}]}`. 사람당 질문당 한 표(upsert), `null` 이면 취소(없는 표 취소도 `200`). 끝난(`done`) 질문만 `409`, 서로 다른 12명 넘으면 `429`(이미 표가 있는 사람의 바꾸기는 통과). `422` 검증 오류 |
| POST | `/ask/:id/feedback` | `{by, note(1~500)}`(메모만. `helpful` 은 받지 않고 `422`) → `201 {id}`. 질문당 50건 한도 `429` |
| POST | `/ask/:id/reask` | `{by, choice: 「너무 일반적이에요」|「이미 해 봤어요」|「우리 상황과 달라요」|「더 자세히 알고 싶어요」, text?(≤280)}` → `200 {status:"pending", reaskCount}`. `done` 인 질문만(`409`), 질문당 최대 3회(초과 `429`). 한 묶음(트랜잭션)으로 현재 답을 `ask_answer_history` 로 옮기고 `pending`·`attempts=0` 으로 돌린다 — 동시에 두 번 눌러도 한 번만 먹는다(둘째는 `409`) |
| DELETE | `/ask/:id` | 소프트 삭제 `204`(질문자 구분 없이 가족 누구나, 기록 삭제 정책과 같다) / `404` |

`/overview` 에 `ask: {pending, worker:{online, seenAt}, medianTotalMs7d, feedback7d:{up,down,notes}}` 가 더해진다(`pending` = 답 기다리는 질문 수, `online` = 2분 안 워커 신호, 중앙값은 최근 7일 `total_ms`, `feedback7d` = 최근 7일 표(👍/👎)·메모 수: 숫자만, 설정 화면 한 줄).

### 워커 API (집 PC 전용, 세션 아님)

경로 접두사 `/api/worker/`. **인증은 `Authorization: Bearer <토큰>` 뿐**이다: 서버는 `ASK_WORKER_TOKEN_HASH`(토큰의 SHA-256 hex)와 상수 시간 비교한다. 세션 쿠키로는 들어올 수 없고, Bearer 로는 다른 `/api/*` 에 들어올 수 없다(`04` §3-2).
`ASK_WORKER_TOKEN_HASH` 가 없거나 형식이 틀리면 `503 worker_disabled`(fail closed). 토큰이 없거나 틀리면 `401`, 실패 10분 20회 초과 시 15분 `429`(PIN 시도와 별도 집계). Origin 이 있으면 자기 origin 이어야 한다(`403`).

| 메서드 | 경로 | 요청/응답 |
|---|---|---|
| POST | `/worker/ask/claim` | `200 {question:{id,body,askedBy,createdAt,redFlag}, reask?:{count,reason,by,previousAnswer}}` / `204`(없음). `reask` 는 다시 답변일 때만(이전 답=가장 최근 이력, 읽을 수 없으면 `previousAnswer: null`). 한 SQL 문으로 원자적으로 집는다(`status='claimed'`, 리스 5분, `attempts+1`). 위급 우선 → 오래된 순. 리스가 끝났는데 시도 3번이면 `failed(too_many_attempts)` |
| POST | `/worker/ask/:id/progress` | `{status:"answering"|"reviewing"}` → `204`, 리스 5분 연장 / `409`(진행 중이 아님) |
| POST | `/worker/ask/:id/answer` | `{level, answer, reviewScore(0~10), model, workMs}` → `200 {status:"done", totalMs}`. `422`: 스키마 위반·`level` 불일치(`level_mismatch`)·60KB 초과(`too_large`)·금지어(`forbidden_word`)·위급 질문인데 10단계가 아님(`redflag_level`). `409`: 진행 중이 아님·이미 답 있음 |
| POST | `/worker/ask/:id/fail` | `{code: [a-z0-9_]{1,40}}` → `200 {status}`: 시도가 남으면 `pending`, 아니면 `failed` |
| GET | `/worker/ask/history?limit=60` | `200 {items:[{id, body, askedBy, createdAt, level, tryNowActions:[string], votes:[{by,helpful,reason,updatedAt}], notes:[{by,note,createdAt}]}]}` — 최근 끝난(`done`) 행동 질문(최신순, `limit` 1~100 정수 아니면 `400`). **본문이 들어 있어 Bearer 전용·`Cache-Control: no-store`·로그 금지**, 응답은 **200KB 상한**(넘으면 오래된 항목부터 뺀다). 질문당 표 12·메모 10개까지. 워커가 claim 직후 받아 60초 캐시해 관련 이전 질문을 고른다(`11` §7, `04` §3-2) |
| GET | `/worker/ping` | `204`(생존 표시 갱신) |

- 모든 호출은 `ask_worker_seen_at` 을 갱신한다(60초에 한 번만 D1 에 쓴다). 오류 응답에 질문·답 본문을 넣지 않는다.
- 경로가 정식 형태(`/api/worker/...` 소문자, 퍼센트 인코딩·이중 슬래시·끝 슬래시 없음)가 아니면 `404`.

## 관리

관리 기능(적재·세션 무효화)은 **웹 API 로 노출하지 않는다.** 관리자 PC 의 `tools/ingest` 가 wrangler 로 D1 에 직접 실행한다(공격 표면 축소).

## 한도 대응
- D1 일일 한도 초과 시 D1 이 오류를 낸다 → API 는 `503 {"error":"quota_exceeded"}` 와 "내일 오전 9시(KST) 이후 다시" 안내.
