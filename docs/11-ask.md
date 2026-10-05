# 11. 물어보기 (T-Q)

가족 누구나 앱에서 아이 행동을 질문하면, 집 PC 에 상주하는 워커가 10초 안에 질문을 집어 Claude Code(Opus, 기존 구독)로
**DB 근거 기반 답변**(10단계 안내 포함)을 만들고, 자체 품질 검사(≥ 9.5)를 거쳐 앱에 올린다. 비용 0(무료 Cloudflare + 기존 구독).
이 저장소는 공개이므로 실제 자료·이름·날짜를 넣지 않는다(합성 픽스처 테스트아이/2020 만).

- 이 문서는 **앱·서버 쪽(T-Q1)** 과 **공용 정의(10단계·답변 스키마·금지어)** 의 정본이다. 워커(`tools/ask-worker`, T-Q2)는 이 정의를 그대로 쓴다.
- 구현 위치: 서버 `server/routes/ask.ts`(세션 API)·`server/routes/worker.ts`(워커 API)·`server/auth/worker.ts`(Bearer 인증)·`server/ask/*`,
  공용 `shared/ask-schema.ts`(zod)·`shared/ask-levels.ts`(10단계)·`shared/ask-forbidden.ts`(금지어), 화면 `src/pages/Ask*Page.tsx`·`src/components/ask/`.
- API 는 `05` 「물어보기」, 표는 `03` §2-ask, 보안(워커 토큰 위협 모델)은 `04` §3-2, 화면은 `06` S50·S51·S91.

## 1. 흐름

```
앱(가족)                     Cloudflare(D1)                    집 PC 워커
 질문 보내기 ──POST /api/ask──▶ ask_question(pending)
   ◀── 접수 + 즉시 결과(비슷한 알림장·자료, AI 없음) + 위급 신호 여부
                                      ◀── 10초마다 POST /api/worker/ask/claim ─── (원자적으로 집음, 리스 5분)
                                      ◀── progress answering → 근거 묶음 → claude(Opus) 답 작성
                                      ◀── progress reviewing → 독립 검토(점수) → <9.5 면 1회 재작성
                                      ◀── POST /answer (스키마 검증 422)  → ask_answer, status=done
 5초마다 조회 ◀─ 접수 → 작성 중 → 검토 중 → 완료(답변 카드)
```

- 위급 신호(red flag)는 **서버가 결정적으로**(키워드, AI 없음) 판정하고, 앱도 같은 모듈(`server/ask/redflags.ts`)로 **쓰는 즉시** 경고한다.
  red flag 질문은 워커가 먼저 집고(`red_flag DESC`), 답은 **10단계 고정**(서버가 다른 단계를 422 로 거절).
- 워커 생존 표시: 워커 호출마다 `app_setting.ask_worker_seen_at` 갱신(D1 쓰기 절약을 위해 최대 60초에 한 번). 2분 안이면 「온라인」.
  오프라인이면 앱이 「집 PC가 켜지면 답변해요」 를 보여 준다.
- 실패: 시도 3번(리스 5분 만료 또는 워커 `fail`) 안에 못 끝내면 `failed`(`too_many_attempts` 등). 앱은 「답을 만들지 못했어요. 다시 질문해 주세요.」.

## 2. 10단계

모든 문서·프롬프트·화면 공용 정의(`shared/ask-levels.ts`). 단계 배지는 **숫자 + 제목 + 아이콘** 으로 보이고 색은 보조일 뿐이다
(1~3 안정 · 4~6 안내 · 7~9 주의 · 10 경고: 새 색 없이 기존 상태색 토큰 재사용).

| 단계 | 의미 |
|---|---|
| 1 | 아주 흔한 발달 과정 |
| 2 | 흔하고 며칠이면 지남 |
| 3 | 흔함, 피곤·환경 변화 영향 |
| 4 | 흔하지만 반복, 작은 방법 1~2개 |
| 5 | 방법 바꾸며 1주 기록 |
| 6 | 2주 기록 후 재평가 |
| 7 | 어린이집과 함께 관찰 |
| 8 | 다음 소아과 진료 때 상담 |
| 9 | 1~2주 안 전문가 상담 권함 |
| 10 | 지금 바로 진료·연락(119·응급실·소아과) |

### 판단 축 6개
빈도 · 지속 · 강도 · 장소(집/기관 모두) · 생활 지장(먹기/자기/놀기/관계) · 월령 대비 흔한 정도(근거 DB). `redFlag=1` 이면 10단계 고정.
같은 질문을 두 번 물었을 때 단계 차는 **1 이하**여야 한다(평가 기준, `tools/ask-worker` eval).

### 금지어 (P1: 판정·꼬리표를 쓰지 않는다)
쓰지 않는 말: **정상 / 비정상 / (판정으로 쓰는) 이상 / 지연 / 장애 / 진단명 / 문제아** 와 비슷한 꼬리표.
「1주 이상」 처럼 수량을 나타내는 「이상」 은 허용한다. 대신 「흔해요 · 지켜봐요 · 상담을 권해요」 식으로 쓴다.
서버는 답변을 저장하기 전에 모든 문자열을 `shared/ask-forbidden.ts` 의 패턴으로 검사해 걸리면 422(`forbidden_word`)로 거절한다
(응답·로그에 걸린 문장을 담지 않는다). 앱 번들에는 이 목록을 넣지 않는다.

## 3. 답변 JSON 스키마

정본: `shared/ask-schema.ts`(zod `AnswerSchema`). 워커 `--json-schema` 용 `tools/ask-worker/answer.schema.json` 은 여기서 생성한다:
`npm run ask:schema`(수정은 항상 zod 쪽에서, 생성 파일은 직접 고치지 않는다). 일치는 `tools/ask-schema.test.ts` 가 확인한다.

| 필드 | 형식 | 비고 |
|---|---|---|
| `level` | 정수 1~10 | 요청의 `level` 과 같아야 함 |
| `levelTitle` | 문자열 ≤40 | 화면은 정본 제목(10단계 표)을 쓴다 |
| `levelReason` | 문자열 ≤600 | 왜 이 단계인지 |
| `summary` | 문자열 ≤600 | 상황 요약(질문 재진술) |
| `fromRecords` | 0~6개 `{date: YYYY-MM-DD, what, source: 알림장·관찰·검진·가족기록}` | 기록에서 본 것 |
| `evidence` | 1~6개 `{ref, point, grade?}` | `ref` = DB 근거 id(claim id, guide 절 등) |
| `tryNow` | 2~4개 `{action, say?}` | 지금 해 볼 것, 할 말 예시(`say`)는 강조 표시 |
| `avoid` | 1~4개 문자열 | 피할 것 |
| `observe` | `{what, howLong, how}` | 관찰 방법 |
| `upIf` / `downIf` | 각 1~4개 문자열 | 단계가 올라가는/내려가는 신호 |
| `forAsker` | 선택 | 질문자(조부모 등) 맞춤 한 줄 |
| `limits` | 선택 | 근거 부족·알림장 한계 |

모든 문자열은 1~600자(근거 `ref` 120자, `levelTitle` 40자), 추가 키 금지(`additionalProperties: false`), 직렬화 JSON ≤ 60 KB.

## 4. 리드타임 목표

PC 가 켜져 있을 때 **p50 ≤ 3분, p90 ≤ 6분**(질문 → 답 게시). 단계별로 기록한다:
`wait_ms`(질문 → 워커가 집음, 목표 ≤ 10초) · `work_ms`(집음 → 답 업로드, 워커 보고) · `total_ms`(질문 → 게시, 서버 계산).
`/api/overview` 의 `ask.medianTotalMs7d`(최근 7일 중앙값)로 목표를 본다. 워커 오버헤드는 claude 호출당 약 5초(도구·MCP·설정 없는 플래그 조합 실측).

## 5. 개인 자료 취급

- 질문·답은 가족 자료(S1)다. D1 에만 있고 로그·오류 메시지·분석에 쓰지 않는다(로그는 경로·상태코드·시간만).
- 워커는 질문 본문을 로그에 남기지 않는다(id·시간·상태만). 설정·로그는 저장소·Drive 밖(`%USERPROFILE%\.yj-ask\`).
- 질문 삭제는 소프트 삭제(기록 삭제 정책과 같다: 가족 누구나).
- 즉시 결과(비슷한 알림장·자료)는 질문의 낱말로 `LIKE` 검색한다(AI 없음). 질문 글은 검색 외에 쓰지 않는다.

## 6. 로드맵

| 카드 | 내용 | 상태 |
|---|---|---|
| T-Q1 | 앱·서버: 0008 표, 세션 API, 워커 API(Bearer 토큰), 답변 스키마(shared)·JSON Schema 내보내기, 위급 신호 모듈, 화면 S50·S51, 목업 API, e2e | 구현(이 문서) |
| T-Q2 | 집 PC 워커 `tools/ask-worker`: 루프·근거 묶음·claude 호출·검토·설치 스크립트·평가 | 별도 작업 |
