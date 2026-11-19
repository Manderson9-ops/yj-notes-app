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
  sync: {state:'none'|'ok'|'running'|'failed'|'missed'|'stuck', lastOkAt, lastAttemptAt, lastAttemptReceivedAt, newReports, lastNoteDate, code},  // T-S1: 알림장 자동 업데이트 상태(서버 판정, `09` §5-2). 날짜·시각은 null 가능, 본문 없음
  security: {lastGlobalLockAt: string | null},   // R1-3: 마지막 전체 잠금(ISO UTC)
  ask: {pending, worker:{online, seenAt}, medianTotalMs7d, redUnhandled},   // T-Q1: 답 기다리는 질문 수(T-Q5: 활성 대화 턴 포함)·워커 상태·7일 답 시간 중앙값(ms, 없으면 null)·카드를 만들지 못한 위급 턴 수
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
| POST | `/ask` | `{body(1~1000자), askedBy(1~12자)}` → `201 {id, status:"pending", redFlag, instant:{notes:[{date,snippet,id}], docs:[{slug,title}]}}`. instant = 알림장 본문·자료 제목/요약의 `LIKE` 검색(각 최대 5, AI 없음). `redFlag` 는 결정적 키워드 검사. 같은 질문자가 10분 안 10건(질문과 후속 턴을 합쳐 센다)을 넘기면 `429 too_many` — 위급 글은 이 한도를 건너뛴다(위급 판정이 먼저). 위급이면 `red_lock=1` 로 저장. `422` 검증 오류 |
| GET | `/ask?before=<id>` | 최신순 20개 `{items:[{id,askedBy,bodyPreview(80자),status,redFlag,level?,createdAt,votes:{up,down}}], nextBefore}` |
| GET | `/ask/:id` | `{question:{id,askedBy,body,createdAt}, status, redFlag, answer?:{level(not_behavior 답은 null), answer(AnswerSchema), createdAt, totalMs, reviewScore(0~10, 없으면 null)}, feedback:[{id,by,note,createdAt}](메모만), votes:[{by,helpful,reason,updatedAt}], history:[{version,level,createdAt,answer}](이전 답, 오래된 것부터. 최신 답은 `answer`), reask:{count,reason,by}}` / `404`(없음·삭제됨·번호 형식 오류). 화면이 5초마다 조회(완료·실패면 멈춤. 대화 중에는 `threadActive` 가 참이면 계속 — 아래 「대화」) |
| GET | `/ask/:id/instant` | `{notes, docs}` — 목록에서 연 질문의 즉시 결과 다시 보기(명세 보강: 폴링에 검색 쿼리를 싣지 않으려고 분리) |
| PUT | `/ask/:id/vote` | `{by, helpful: true|false|null, reason?(≤200, 👎 일 때만)}` → `200 {votes:[{by,helpful,reason,updatedAt}]}`. 사람당 질문당 한 표(upsert), `null` 이면 취소(없는 표 취소도 `200`). 끝난(`done`) 질문만 `409`, 서로 다른 12명 넘으면 `429`(이미 표가 있는 사람의 바꾸기는 통과). `422` 검증 오류 |
| POST | `/ask/:id/feedback` | `{by, note(1~500)}`(메모만. `helpful` 은 받지 않고 `422`) → `201 {id}`. 질문당 50건 한도 `429` |
| POST | `/ask/:id/reask` | `{by, choice: 「너무 일반적이에요」|「이미 해 봤어요」|「우리 상황과 달라요」|「더 자세히 알고 싶어요」, text?(≤280)}` → `200 {status:"done", reaskCount, id, seq}`. **호환용**(T-Q5): 질문을 `pending` 으로 되돌리거나 현재 답을 지우지 않는다. 카드만 만드는 `kind='reask'` 턴(짧은 답 없음, `card_status='pending'`)을 만들고 `reask_count`·`reask_reason`·`reask_by`·`reask_at` 을 같은 묶음으로 갱신한다. 검사·우선순위는 `/turn` 과 같다. 자유 글(`text`)에 위급 신호가 있으면 reask 가 아니라 위급 후속 턴을 만든다(`201`, `/turn` 응답 모양). 위급 잠금 질문은 `422 redflag_level`, 카드 갱신 3번을 다 쓰면 `429 card_limit` |
| DELETE | `/ask/:id` | 소프트 삭제 `204`(질문자 구분 없이 가족 누구나, 기록 삭제 정책과 같다) / `404` |

### 대화 — 후속 질문·짧은 답·카드 갱신 (T-Q5, `11`)

답 카드가 나온 질문(`done`)에 이어서 묻는다. 한 번에 한 건씩 처리하고(활성 턴이 있으면 입력 잠금), 필요할 때만 원래 카드를 새 버전으로 고친다. 질문 `status` 는 대화 내내 `done` 이다.

| 메서드 | 경로 | 요청/응답 |
|---|---|---|
| POST | `/ask/:id/turn` | `{body(1~1000자), askedBy(1~12자)}` → `201 {id, seq, redFlag:false}`(일반 후속, 턴 `status='pending'`). 위급 후속(`detectRedFlag`) + 질문 `done` → `201 {id, seq, redFlag:true}`(잠금·카드 대기 턴, 아래). 위급 후속인데 질문이 `done` 이 아님 → 턴 없이 새 위급 질문(`origin_question_id` = 원 질문) `201 {newQuestionId, redFlag:true}` |

검사 우선순위(처음 걸리는 것): `422 validation_error`(본문 형식, DB 보기 전) → `404`(질문 없음·삭제) → `429 too_many`(레이트리밋 — 질문과 후속·reask 가 10분 10건을 나눠 쓴다. **위급이면 건너뛴다**, 카운트에는 들어간다) → `409 question_busy`(질문이 `done` 이 아님) → `409 turn_active`(활성 턴 있음) → `422 redflag_level`(reask 만) → `429 turn_limit`(위급이 아닌 턴 10번 — 실패한 턴도 센다, 삭제된 턴은 뺀다) → `429 card_limit`(reask 만, 카드 갱신 3번 사용). 활성 턴 = 짧은 답 단계(`status` 가 `pending`·`claimed`·`answering`·`reviewing`)이거나 카드를 만드는 중(`card_status='pending'`). 「활성 턴 없음·턴 수 < 10」 검사와 INSERT 는 한 문장이라 동시에 두 가족이 보내도 한 건만 생긴다(나머지는 `409`).

위급 후속은 `409 question_busy`·`409 turn_active`·`429 turn_limit`·`too_many` 를 모두 건너뛴다. 한 묶음(트랜잭션)으로 질문 `red_lock=1` + 일반 턴의 카드 대기를 `card_status='none'`·`card_note='redlock'` 으로 정리 + 위급 턴(`red_flag=1`, `status='done'`, `reply_json` 없음, `card_status='pending'`)을 넣는다. 위급 턴은 `turnsUsed`·카드 갱신 횟수(`card_updates`)에 세지 않는다. 잠금은 이 질문에서 영구적이다(워커 `/card` 가 10단계가 아닌 카드를 `422 redflag_level` 로 거절).

`DELETE /ask/:id` 는 같은 묶음에서 그 질문의 턴도 `deleted_at` 을 채운다. 질문 응답의 `/ask/:id` 새 필드는 위 표의 `GET /ask/:id` 행에 더해진 것이다:

- `workerOnline` — seen 이 2분 안이거나, 리스가 살아 있는 작업(질문·턴 짧은 답 `lease_until >= 지금`, 턴 카드 `card_lease_until >= 지금`)이 하나라도 있으면 참(작업 중에는 claim 을 하지 않아 seen 이 끊기는 것을 보정). `/overview` 의 `ask.worker.online` 도 같은 함수다.
- `threadActive`(활성 턴이 하나라도 있음), `redLock`(`red_lock=1` 또는 `red_flag=1`), `cardUpdates:{used, max}`(`max` = `ASK_REASK_MAX` 3), `turnsUsed`, `originQuestionId`(`number|null`).
- `turns:[{id, seq, kind:'followup'|'reask', askedBy, body, reaskReason, redFlag, status, reply, reviewScore, cardStatus:'none'|'pending'|'done'|'failed', cardNote:'limit'|'redlock'|null, cardVersion, createdAt, repliedAt}]` — seq 오름차순, 삭제 안 된 턴 전부(위급 포함). `reply` = 후속 짧은 답(`FollowupSchema`: `{reply, say?, fromRecords, evidence, cardUpdate:{needed, reason}, limits?}`) 또는 `null`(reask·위급 턴 / 읽을 수 없는 JSON). `cardVersion` = 그 턴이 만든 카드의 번호(= 이력 이동 뒤 최신 이력 번호 + 1).

오류 코드 규칙: `429` = 횟수 한도(`turn_limit`·`card_limit`) 또는 레이트리밋(`too_many`), `409` = 진행 중 충돌(`turn_active`·`question_busy`·`conflict`), `422` + `code:"redflag_level"` = 위급 잠금 위반. 앱은 `error` 값으로 가른다.

`/overview` 에 `ask: {pending, worker:{online, seenAt}, medianTotalMs7d, feedback7d:{up,down,notes}, redUnhandled}` 가 더해진다(`pending` = 답 기다리는 질문 수 + 활성 대화 턴 수(삭제 안 된 질문의 것), `online` = `workerOnline`(위 「대화」), `redUnhandled` = 카드를 끝내 만들지 못한(`card_status='failed'`) 위급 턴 수, 중앙값은 최근 7일 `total_ms` — 창은 `ask_question.created_at` 기준(카드 갱신이 `ask_answer.created_at` 을 새로 쓰므로), `feedback7d` = 최근 7일 표(👍/👎)·메모 수: 숫자만, 설정 화면 한 줄).

### 워커 API (집 PC 전용, 세션 아님)

경로 접두사 `/api/worker/`. **인증은 `Authorization: Bearer <토큰>` 뿐**이다: 서버는 `ASK_WORKER_TOKEN_HASH`(토큰의 SHA-256 hex)와 상수 시간 비교한다. 세션 쿠키로는 들어올 수 없고, Bearer 로는 다른 `/api/*` 에 들어올 수 없다(`04` §3-2).
`ASK_WORKER_TOKEN_HASH` 가 없거나 형식이 틀리면 `503 worker_disabled`(fail closed). 토큰이 없거나 틀리면 `401`, 실패 10분 20회 초과 시 15분 `429`(PIN 시도와 별도 집계). Origin 이 있으면 자기 origin 이어야 한다(`403`).

| 메서드 | 경로 | 요청/응답 |
|---|---|---|
| POST | `/worker/ask/claim` | 질문이면 `200 {type:"question", question:{id,body,askedBy,createdAt,redFlag}, reask?:{count,reason,by,previousAnswer}}`, 대화 턴이면 `200 {type:"turn", stage:"reply"|"card", cardUpdatesLeft, redLock, turn:{id,seq,kind,body,redFlag,reaskReason,askedBy,reply,cardReason,reask?}, thread:{question,card,turns:[{by,body,reply,kind,reaskReason}]}}`(**최상위 `question` 없음** — 옛 워커가 질문으로 오해해 시도를 태우지 않게) / `204`(없음). `reask` 는 옛 방식 다시 답변으로 대기 중이던 질문일 때만(이전 답=가장 최근 이력, 읽을 수 없으면 `previousAnswer: null`). 질문과 턴을 함께 보고 위급 우선 → 오래된 순 1건을 고른 뒤, 같은 대기 조건을 다시 건 UPDATE 로 원자적으로 집는다(`status='claimed'`, 리스 5분, `attempts+1`. 0행이면 한 번 더 시도). 서버 환경변수 `ASK_TURN_CLAIM`(선택, `"0"` 이면 턴을 고르지 않고 질문 응답 모양도 `type` 없이 T-Q5 이전과 같다 — 워커만 되돌릴 때 먼저 0 으로). 상세 아래 「대화 턴 claim」. 리스가 끝났는데 시도 3번이면 `failed(too_many_attempts)` |
| POST | `/worker/ask/:id/progress` | `{status:"answering"|"reviewing"}` → `204`, 리스 5분 연장 / `409`(진행 중이 아님) |
| POST | `/worker/ask/:id/answer` | `{level, answer, reviewScore(0~10), model, workMs}` → `200 {status:"done", totalMs}`. `422`: 스키마 위반·`level` 불일치(`level_mismatch`)·60KB 초과(`too_large`)·금지어(`forbidden_word`)·위급 질문인데 10단계가 아님(`redflag_level`). `409`: 진행 중이 아님·이미 답 있음 |
| POST | `/worker/ask/:id/fail` | `{code: [a-z0-9_]{1,40}}` → `200 {status}`: 시도가 남으면 `pending`, 아니면 `failed` |
| GET | `/worker/ask/history?limit=60` | `200 {items:[{id, body, askedBy, createdAt, level, tryNowActions:[string], votes:[{by,helpful,reason,updatedAt}], notes:[{by,note,createdAt}]}]}` — 최근 끝난(`done`) 행동 질문(최신순, `limit` 1~100 정수 아니면 `400`). **본문이 들어 있어 Bearer 전용·`Cache-Control: no-store`·로그 금지**, 응답은 **200KB 상한**(넘으면 오래된 항목부터 뺀다). 질문당 표 12·메모 10개까지. 워커가 claim 직후 받아 60초 캐시해 관련 이전 질문을 고른다(`11` §7, `04` §3-2) |
| GET | `/worker/ping` | `204`(생존 표시 갱신) |
| POST | `/worker/sync/start` | `{startedAt: ISO8601(Z 또는 +09:00 같은 오프셋 표기, UTC 로 바꿔 저장)}` → `200 {id}`. `422`: 형식 위반·여분 키·서버 시각 −2일/+10분 밖. 이 호출이 90일 지난 `sync_run` 행을 지운다 |
| POST | `/worker/sync/:id/finish` | `{status:'ok'|'no_new'|'failed', stage?, code?, newReports?, newComments?, lastNoteDate?}` → `204`. zod 엄격(여분 키 거절): `stage` ∈ fetch·merge·build·verify·media·downstream·commit·ingest·report, `code` `^[a-z0-9_]{1,40}$`(`failed` 는 필수, `ok`·`no_new` 는 `needs_reading`·`guide_asof_due` 만), 건수 정수 0~10000(`no_new` 는 `newReports` 0), `lastNoteDate` YYYY-MM-DD. 진행 중(`running`)인 행만 한 번 끝낼 수 있다: 두 번째 보고·이미 끝난 행은 `409`, 없는 id 는 `404`, 검증 실패는 `422`. 본문·이름은 받지 않는다 |

#### 대화 턴 (T-Q5)

한 claim 은 한 단계만 한다. 짧은 답을 확정(`reply`)하면 워커는 claim 을 끝내고 루프로 돌아가며, 카드가 필요하면 다음 claim 이 카드 단계(`stage:"card"`)로 같은 턴을 다시 집는다(그 사이 들어온 위급 건을 먼저 집을 수 있게). 짧은 답 단계와 카드 단계는 시도·리스 회계가 따로다(`attempts`·`lease_until` / `card_attempts`·`card_lease_until`).

| 메서드 | 경로 | 요청/응답 |
|---|---|---|
| POST | `/worker/ask/turn/:tid/progress` | `{stage:"reply", status:"answering"|"reviewing"}` → `204`, 턴 `status`·`lease_until` 갱신(수락: `claimed`·`answering`·`reviewing`). `{stage:"card"}` → `204`, `card_lease_until` 만 연장(`status` 는 `done` 으로 둔다. 수락: `status='done' AND card_status='pending'`). 수락 못 하면 `409`, 턴·부모 질문이 없거나 지워졌으면 `404`. 워커 생존 표시 갱신 |
| POST | `/worker/ask/turn/:tid/reply` | `{reply:FollowupSchema, reviewScore(0~10 숫자만), model, workMs, cardWanted, cardSkip:"limit"|"redlock"|null, cardReason(≤160)}` → `200 {status:"done", cardStatus:"none"|"pending"}`. 서버가 같은 UPDATE 에서 잠금을 다시 봐서(질문 `red_lock`·`red_flag` 이고 이 턴이 위급이 아님) `cardWanted` 여도 `none`+`card_note='redlock'` 으로 둘 수 있다. `card_note` 에는 `cardSkip` 을 그대로 저장. `422`: 스키마 위반(`reviewScore: null` 포함 — 미검토 확정은 T-Q4b)·금지어(`forbidden_word`)·크기(`too_large`). `409`: 진행 중이 아님·이미 확정. `404`: 지워진 질문·없는 턴. 워커 생존 표시 갱신 |
| POST | `/worker/ask/turn/:tid/card` | `WorkerAnswerSchema` 본문(질문 `/answer` 와 같은 검증) → `200 {status:"done", cardVersion}`. 한 묶음: ① 현재 `ask_answer` 를 `ask_answer_history` 로 옮기고(`reask_count` 조건 없음) ② `ask_answer` 를 새 카드로 UPDATE(DELETE 없음 — 카드가 비는 순간이 없다. `level`·`answer_json`·`review_score`·`model`·`created_at` 만 바꾸고 `wait_ms`·`work_ms`·`total_ms` 는 첫 답 값) ③ 위급이 아닌 턴이면 `card_updates+1` ④ 턴 `card_status='done'`·`card_version`·`card_work_ms`. 모든 문장이 수락 조건을 다시 건다. 응답 순서: `404`(부모 삭제) → `409`(`card_status` 가 `pending` 이 아님) → `422 validation_error`(본문 형식) → `422 redflag_level`(위급 잠금인데 10단계가 아님. 위급이 아닌 턴이면 `card_status='none'`·`card_note='redlock'` 기록) → `429 card_limit`(위급이 아닌 턴인데 `card_updates >= 3`, `card_note='limit'` 기록) → 그 밖의 `422`(`level_mismatch`·`too_large`·`forbidden_word`). 잠금 뒤 일반 턴이 10단계 카드를 올리면 묶음 조건에서 `409`. 워커 생존 표시는 갱신하지 않는다 |
| POST | `/worker/ask/turn/:tid/fail` | `{stage:"reply"|"card", code:[a-z0-9_]{1,40}}` → `200 {status, cardStatus}`. `reply`: 질문 `fail` 과 같은 규칙(`attempts>=3` 이면 `failed`, 아니면 `pending`, `lease_until` 비움 — 냉각 없이 바로 다시 집힌다). `card`: `card_attempts>=3` 이면 `card_status='failed'`+`card_fail_code`, 아니면 `pending`(`card_lease_until` 비움 — 짧은 답은 유지). 수락 못 하면 `409` |

**대화 턴 claim**: 짧은 답 단계 후보 = `(status='pending' OR (status IN 진행 상태 AND lease_until < 지금)) AND attempts < 3`, 카드 단계 후보 = `status='done' AND card_status='pending' AND card_attempts < 3 AND (card_lease_until IS NULL OR card_lease_until < 지금) AND (부모 잠금 아님 OR 위급 턴)`(둘 다 턴·부모 `deleted_at IS NULL`). 집을 때 짧은 답 단계는 `status='claimed'`·`lease_until`·`attempts+1`, 카드 단계는 `card_lease_until`·`card_attempts+1`. 응답의 `thread` 는 claim UPDATE **뒤에** 읽는다(`question` = 원 질문, `card` = 현재 카드 또는 `null`, `turns` = 지금 턴 앞의 최근 10턴 seq 순 — 위급·reask 포함). 카드 단계면 `turn.reply`(확정된 짧은 답)·`turn.cardReason` 이 오고, reask 턴이면 `turn.reask:{count, reason, by, previousAnswer(현재 카드)}` 가 온다. claim 앞에서 정리 세 가지를 한 묶음으로 한다 — ① 잠긴 질문의 일반 턴 카드 대기를 `card_status='none'`·`card_note='redlock'`(먼저) ② 카드 시도 3번이 끝난 턴을 `card_status='failed'`·`card_fail_code='too_many_attempts'` ③ 짧은 답 시도 3번이 끝난 턴을 `status='failed'`·`fail_code='too_many_attempts'`.

- `ask_worker_seen_at` 은 claim·ping·턴 `progress`·턴 `reply` 가 갱신한다(60초에 한 번만 D1 에 쓴다. 질문 `progress`·`answer`·`fail` 과 턴 `card`·`fail` 은 갱신하지 않는다). 오류 응답에 질문·답 본문을 넣지 않는다.
- 경로가 정식 형태(`/api/worker/...` 소문자, 퍼센트 인코딩·이중 슬래시·끝 슬래시 없음)가 아니면 `404`.

## 관리

관리 기능(적재·세션 무효화)은 **웹 API 로 노출하지 않는다.** 관리자 PC 의 `tools/ingest` 가 wrangler 로 D1 에 직접 실행한다(공격 표면 축소).

## 한도 대응
- D1 일일 한도 초과 시 D1 이 오류를 낸다 → API 는 `503 {"error":"quota_exceeded"}` 와 "내일 오전 9시(KST) 이후 다시" 안내.
