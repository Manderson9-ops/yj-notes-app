# 12. 물어보기 워커 (집 PC) — 설치·운영

가족이 앱에서 한 질문을 집 PC 의 상주 워커가 10초 안에 집어, Claude Code(Opus, 기존 구독)로 근거 기반 답을 만들고
스스로 검토한 뒤 앱에 게시한다. 비용 0(무료 Cloudflare + 기존 구독). 설계 정본은 T-Q 명세 §3·§4·§5·§7.

## 구성

| 파일 | 역할 |
|---|---|
| `tools/ask-worker/worker.ts` | 루프(10초마다 claim). `--once`, `--dry-run` |
| `tools/ask-worker/context.py` | 근거 묶음 생성(읽기 전용, ≤16k 토큰) |
| `tools/ask-worker/prompts/system.md` | 작성 규칙(10단계·금지어·인용 규칙) |
| `tools/ask-worker/prompts/review.md` | 검토 채점표(10점) |
| `tools/ask-worker/answer.schema.json` | 답변 JSON 스키마(draft 2020-12). 앱의 `shared/ask-schema.ts` 와 같은 내용 |
| `tools/ask-worker/checks.ts` | 결정적 검사(스키마·금지어·redFlag→10·ref/날짜 실재) |
| `tools/ask-worker/scheduler.ts` | 작업 스케줄러 등록/삭제/상태 |
| `tools/ask-worker/eval.ts` | 골든 세트 평가 |

흐름: claim → progress(answering) → 질문 확장 → 근거 묶음 → 작성(claude) → 결정적 검사 → progress(reviewing) → 검토(claude)
→ 점수 < 9.5 면 지적만 고치는 재작성 **1회**·재검토(더 높은 점수 채택) → answer 업로드. 결정적 검사에서 걸리면 검토를 건너뛰고 바로 재작성한다. 품질 정책 상세는 docs/11 §3-2. 9.5 미만으로 게시된 답은 `reviewScore` 로 서버에 저장되고, 앱이 「품질 검사 기준보다 낮아 참고용이에요」를 작게 보여 준다.
실패하면 `fail(code)` 로 되돌린다(3회 실패 시 서버가 failed 처리). 코드: `pack_failed`, `claude_exit`, `timeout`,
`checks_failed`, `low_score`(게시 하한 8.5 미만), `review_invalid`, `upload_<HTTP>`, `worker_stopped`, `internal_error`.

## 1. 토큰 만들기와 Pages 비밀값

토큰은 이 PC 에서만 만들고, 서버에는 SHA-256(16진) **해시만** 둔다. 토큰 원문은 어디에도 붙여 넣지 않는다(채팅·이슈·커밋 금지).

```powershell
# 토큰을 만들어 worker.env 에 바로 추가하고, 화면에는 해시만 출력한다(토큰은 화면에 나오지 않는다)
node -e "const c=require('node:crypto'),f=require('node:fs'),p=require('node:path');const d=p.join(process.env.USERPROFILE,'.yj-ask');f.mkdirSync(d,{recursive:true});const t=c.randomBytes(32).toString('hex');f.appendFileSync(p.join(d,'worker.env'),'ASK_WORKER_TOKEN='+t+'\n');console.log(c.createHash('sha256').update(t).digest('hex'))"
# 출력된 해시를 Pages 비밀값으로 등록(프롬프트에 붙여 넣기)
npx wrangler pages secret put ASK_WORKER_TOKEN_HASH --project-name yj-notes-app
```

`ASK_WORKER_TOKEN_HASH` 가 없으면 서버는 `/api/worker/*` 를 503 으로 막는다(안전 쪽). 토큰을 바꾸려면 새 토큰의 해시를
같은 방법으로 다시 등록하고 `worker.env` 를 고친 뒤 워커를 다시 시작한다.

## 2. worker.env

파일 위치는 **`%USERPROFILE%\.yj-ask\worker.env`**. 저장소 안이나 Google Drive 안이면 워커가 시작을 거부한다.

```
APP_ORIGIN=https://<앱 주소>
ASK_WORKER_TOKEN=<1번에서 만든 토큰>
DATA_DIR=<DATA_DIR 경로>
# 선택
# CHILD_BIRTH_DATE=YYYY-MM-DD   (선택: 월령을 생년월일로 계산. 없으면 가장 최근 알림장 월령에 지난 달을 더해 계산. 근거 묶음 맨 위에 현재 월령 으로 들어간다)
# CLAUDE_BIN=C:\Users\<이름>\.local\bin\claude.exe
# PYTHON_BIN=C:\...\python.exe
# ASK_POLL_MS=10000
# ASK_MIN_PUBLISH_SCORE=8.5
# ASK_CLAUDE_TIMEOUT_MS=240000
# ASK_EXPAND_MODEL=sonnet        (질문 확장용 모델. 안 되면 다른 쪽(haiku)으로 한 번 더. 실측: sonnet low 약 5초, haiku 12~19초)
# ASK_REVIEW_MODEL=opus          (검토·재검토 모델. 작성·재작성은 opus 그대로. 영문·숫자·._- 3~40자가 아니면 opus)
# ASK_AUTH_PAUSE=1               (로그인 만료(exitKind=auth) 때 claim 을 멈추고 시험 호출로만 푼다. 0 이면 끔 — 아래 §4)
# ASK_LOG_KEEP_DAYS=14           (워커 로그 보관 일수, 1~3650)
```

`DATA_DIR` 는 읽기 전용으로만 쓴다(알림장·guide·근거 DB). 최신 ingest export 는
`%LOCALAPPDATA%\yj-notes\ingest\<최신 run>` 에서 읽는다(`YJ_INGEST_ROOT` 로 바꿀 수 있음).
파일 권한은 본인 계정만 읽도록 두는 것을 권한다: `icacls "%USERPROFILE%\.yj-ask\worker.env" /inheritance:r /grant:r "%USERNAME%:F"`.

claude 호출은 구독 로그인만 쓰며 `ANTHROPIC_API_KEY` 류 환경변수는 자식 프로세스에서 제거한다(API 과금 방지).
먼저 터미널에서 `claude` 로 한 번 로그인해 둔다.

## 3. 시험과 설치

```powershell
npm run ask-worker:once -- --dry-run              # 합성 질문+합성 픽스처로 파이프라인 시험(claim·네트워크 없음, claude 는 실제 호출)
npm run ask-worker:once -- --dry-run --print-answer
npm run ask-worker:once                           # 실서버에서 한 건만 claim 해 처리
npm run ask-worker                                # 루프(수동 실행)

npm run ask-worker:install                        # 작업 스케줄러 등록: 로그온 시 실행, 숨김, 실패 시 1분 후 재시작
npm run ask-worker:status
npm run ask-worker:uninstall
```

설치는 관리자 권한이 필요 없다(현재 사용자, 최소 권한, 로그온 트리거). `wscript` 런처(`%USERPROFILE%\.yj-ask\run-worker.vbs`)가
창 없이 node 를 실행하고 종료 코드를 그대로 돌려줘 비정상 종료 때 스케줄러가 다시 시작한다.
단일 인스턴스 잠금(`%USERPROFILE%\.yj-ask\worker.lock`)이 있어 중복 실행되지 않는다.

## 4. 로그와 상태

- 로그: `%USERPROFILE%\.yj-ask\logs\worker-YYYY-MM-DD.log` (JSON 한 줄씩, 기본 14일 보관 — `ASK_LOG_KEEP_DAYS`). **질문·답변 본문은 기록하지 않고** id·단계·시간·상태·코드만 남는다.
- 주요 줄(`event`): `claimed`·`stage`(`id`·`stage`·`ms`)·`answered`·`failed`(`id`·`code`·`ms`, claude 실패면 `exitKind`), 시작 때 `effort_env`(`present` — 환경변수 `CLAUDE_CODE_EFFORT_LEVEL` 이 있는지만. 있으면 자식 claude 가 그 값을 쓴다)·`loop_start`, 로그인 만료 때 `auth_paused`·`auth_resumed`, 시작 시험 실패 때 `probe_failed`(`exitKind`).
- `exitKind`: claude 가 비정상 종료(`claude_exit`)하거나 오류 봉투(`claude_error`)를 내면 stderr·봉투의 `result` 문구를 정규식으로만 분류해 `usage_limit`(사용량 한도)·`auth`(로그인 만료)·`overloaded`(과부하)·`other` 중 하나를 남긴다. 문구 자체는 저장하지 않는다. CLI 문구가 바뀌어 맞는 것이 없으면 `other`(동작은 그 전과 같다).
- **로그인 만료 일시정지**(`ASK_AUTH_PAUSE=1`, 기본): 워커는 시작할 때 질문 자료 없는 합성 프롬프트로 시험 호출(시간 상한 60초)을 한 번 하고, **성공한 뒤에만 claim 한다**. 시험이 `auth` 로 실패하면 일시정지, 그 밖의 실패(네트워크가 아직 없는 부팅 직후 등)면 60초 뒤 다시 시험한다. 처리 중 작성·검토·재작성·재검토 어느 단계든 `auth` 가 나면 그 질문의 나머지 단계와 2초 재실행을 하지 않고 지금 코드(`claude_exit`, 오류 봉투면 `claude_error`)로 fail 한 뒤 일시정지한다(그 질문은 시도 1회를 쓴다. 질문 확장은 실패를 삼키므로 그 auth 는 작성 단계에서 잡힌다). `--once` 도 시험 호출이 성공해야 claim 한다. 일시정지 중에는 claim 하지 않고 10분마다 시험 호출을 해서 **성공했을 때만** 푼다(사용량 한도·시간 초과로 실패하면 계속 멈춰 있다). 프로세스는 끝나지 않는다. 다시 로그인한 뒤 워커를 다시 시작하면 시작 시험이 바로 풀어 준다. `ASK_AUTH_PAUSE=0` 이면 시험·일시정지·재실행 생략을 모두 하지 않고 `exitKind` 기록만 남는다.
- 근거 묶음 캐시: `%USERPROFILE%\.yj-ask\cache\child-<export run id>.json` (export 가 새로 올라온 run 으로 바뀔 때만 다시 만든다).
- 앱 홈의 워커 표시는 서버의 `ask_worker_seen_at`(claim·ping 때 60초에 한 번 갱신) 기준 2분 이내면 온라인.

## 5. 골든 세트 평가

```powershell
npm run ask-worker:eval -- --set "<DATA_DIR>\ask-eval\golden.jsonl" --out "<DATA_DIR>\ask-eval\results" [--runs 2] [--limit 5]
```

`golden.jsonl` 한 줄: `{"id":"g01","question":"…","askedBy":"할머니","redFlag":false}` (`askedBy`·`redFlag` 선택).
각 질문을 `--runs`(기본 2)회 돌려 평균·최저 점수, 항목별(근거·기록·실행·안전·말투) 평균, 같은 질문 단계 차 ≤ 1 비율을
`eval-<시각>.json` / `.md` 로 저장한다. 결과 파일에는 질문·답변 본문이 없고 id·점수·시간만 있다.
`--set`·`--out`·`--history`·`--reask` 가 저장소 안이면 거부한다. 저장소에는 형식만 두고 실제 질문·답은 두지 않는다.
결과 머리에 `claudeVersion`(`claude --version`)과 `reviewModel` 이, run 마다 단계별 실제 모델 ID(`models`)가 남는다.
오류는 `단계:코드`(예: `review:claude_exit` — 마지막으로 진행한 단계)로 남는다.

### 5-2. 검토 모델 비교용 옵션 (T-Q4a)

```powershell
# 검토 모델만 바꿔 전체 실행(worker.env 는 그대로). --save-answers 는 첫 작성본과 최종 답을 검토 입력과 함께 저장
npm run ask-worker:eval -- --set <golden.jsonl> --out "<DATA_DIR>\ask-eval\<폴더>" --runs 2 --save-answers --review-model sonnet
# 저장된 답에 검토 단계만(근거 묶음을 다시 만들지 않는다). 기본은 첫 작성본, --score 면 최종 답을 운영 점수식으로 채점
npm run ask-worker:eval -- --review-only "<answers 파일 또는 그것 하나만 든 폴더>" --out <결과 폴더> --review-model opus [--score]
# 두 전체 실행 비교: 두 실행 모두 오류 없이 끝난 문항의 교집합으로 평균·단계 일관성 비율, 실행별 오류 수
npm run ask-worker:eval-compare -- <결과 A> <결과 B> [--set <golden.jsonl>]
```

- `--review-model <모델>`: 그 실행의 검토·재검토만 이 모델을 쓴다(작성·재작성은 그대로).
- `--save-answers` 파일(`answers-<시각>.json`, 형식 2): 문항·run 마다 `stage` 가 `first`(첫 작성본, 검토 전 — 그 run 이 `low_score` 등 예외로 끝나도 저장)와 `final`(게시될 답)인 항목, 각 항목에 검토 입력(`promptPack` 근거 묶음·`pq` 질문 정보·`info` 결정적 검사 입력). 첫 작성이 HARD 라 초안이 될 수 없는 run 은 `noFirstDraft` 에 적힌다. **근거 묶음에 가족 기록이 들어가므로 `<DATA_DIR>\ask-eval\` 아래에만 둔다.** 형식 2 가 아닌 옛 파일은 `--review-only` 가 받지 않는다.
- `--review-only` 결과(`review-<시각>.json`): 답마다 범주별 **검토자 지적 수**(코드가 만든 SOFT 항목은 넣지 않는다)와 검토자 실제 모델 ID, 검토 호출이 실패한 답은 `error`. `--score` 면 답마다 검토자 지적 + 코드 SOFT 항목으로 운영과 같은 점수식(10 − 감점)의 점수와 평균(실패한 답은 평균에서 빼고 `failed` 로 센다). 앞 검토 없이 새로 보므로 운영 최종 점수보다 낮게 나올 수 있다.
- 비교 결과의 오류 수(`errors`, 오류가 난 문항 수): `review`(검토·재검토 단계)·`lowScore`(단계 무관)·`unreviewed` 와 그 합 `gate`, 비교에서 빼는 `authoring`(작성 단계 도구 실패 등). `--set` 을 주면 각 결과의 문항 id 집합이 세트와 같은지(`idSetMatchesSet`, 다르면 중간에 멈춘 실행)도 낸다.

### 5-1. 가족 의견 주입 옵션 (T-Q3)

```powershell
npm run ask-worker:eval -- --set <golden.jsonl> --out <결과 폴더> --history <history.json> --reask <reask.json>
node tools/ask-worker/worker.ts --dry-run --history <history.json> --reask <reask.json>   # 합성 질문 1건 (reask 는 단일 덩어리 또는 "dry-run" 키)
```

- `--history <json>`: 합성 가족 결과 주입. **`HistoryItem[]` 또는 `{"items": HistoryItem[]}`** (= `GET /api/worker/ask/history` 응답과 같다). `HistoryItem` = `{"id": 12, "body": "…", "askedBy": "엄마", "createdAt": "2020-03-01T00:00:00.000Z", "level": 4, "tryNowActions": ["…", "…"], "votes": [{"by": "할머니", "helpful": false, "reason": "…"|null, "updatedAt": "…"}], "notes": [{"by": "엄마", "note": "…", "createdAt": "…"}]}`. 워커의 관련 질문 고르기·묶음 구역·검사가 그대로 돈다(질문 확장이 고른 주제·낱말과 본문 겹침 기준).
- `--reask <json>`: 다시 답변 상황 주입. **한 덩어리 `{"reason": "이미 해 봤어요 · 자유 글", "by": "엄마", "count": 1, "previousAnswer": <Answer>}`**(모든 문항에 적용; `by`·`count` 는 생략하면 `"가족"`·`1`) 또는 **문항별 `{"g01": {…위 덩어리…}, "g02": {…}}`**(골든 `id` 키, 없는 문항은 처음 질문으로). `reason` 은 「선택지」 또는 「선택지 · 자유 글」: 너무 일반적이에요 / 이미 해 봤어요 / 우리 상황과 달라요 / 더 자세히 알고 싶어요. `previousAnswer` 는 `AnswerSchema`(`shared/ask-schema.ts`)를 만족해야 하고 `null` 도 된다(이전 답을 불러오지 못한 경우).
- 형식 검증은 `tools/ask-worker/inject.ts`(zod). 이 파일들은 합성·평가용이며 실제 가족 자료는 저장소 밖에 둔다.

## 6. 리드타임 측정

목표: p50 ≤ 3분, p90 ≤ 6분(PC 켜짐). 서버는 답변 저장 때 `wait_ms`(접수→claim)·`work_ms`(claim→answer)·`total_ms` 를 기록하고
overview 에 7일 중앙값(`medianTotalMs7d`)을 낸다.

- 워커 쪽 단계별 시간: 로그의 `stage` 줄(`pack`, `generate`, `review`, `rewrite`, `review2`, `rewrite2`, `review3`)과 `answered` 줄의 `ms`.
- 분포 계산(로컬 로그만 사용, 본문 없음):
  ```powershell
  Get-Content "$env:USERPROFILE\.yj-ask\logs\worker-*.log" | ForEach-Object { $_ | ConvertFrom-Json } |
    Where-Object event -eq answered | ForEach-Object ms | Sort-Object |
    ForEach-Object -Begin { $a = @() } -Process { $a += $_ } -End { "n=$($a.Count) p50=$($a[[int]($a.Count*0.5)]) p90=$($a[[int]($a.Count*0.9)])" }
  ```
- claude 미리 띄우기 벤치(T-Q4a, 합성 프롬프트로 `claude -p` 약 30회): `node tools/ask-worker/prespawn-bench.ts --out <저장소·DATA_DIR 밖 폴더> [--bin <claude.exe>]`. 「즉시 쓰기」와 「6초 뒤 쓰기」의 stdin 쓰기 → 종료 시간을 5쌍(순서 교대) 재고, 두 프로세스를 겹쳐 띄우는 실행 10회의 비정상 종료를 센다. 쌍별 차 중앙값 ≥ 3초·4/5 쌍 이상 6초 뒤 쪽이 빠름·겹쳐 띄우기 비정상 종료(시간 초과 포함) 0 이면 `adopt: true`. 쓰기 전에 프로세스가 끝난 실행은 `exited_before_write` 로 적는다.
- 합성 드라이런 실측(Opus, 합성 픽스처, 재작성 없음): 근거 묶음 0.2초, 작성 약 24초, 검토 약 10초, 합계 약 35초(점수 9.7). 재작성이 들어가면 재작성 약 20초 + 재검토 약 12초가 더해져 최대 약 70초. claim 대기(최대 10초)와 PC 부하에 따라 달라진다.

## 7. 문제 해결

| 증상 | 확인 |
|---|---|
| 시작 즉시 종료, "설정 파일" 메시지 | `worker.env` 위치(저장소·Drive 밖인지), `APP_ORIGIN`(https), 토큰 길이 16자 이상 |
| 로그에 `claim_error api_401` | 토큰과 Pages 의 `ASK_WORKER_TOKEN_HASH` 불일치. 1번 절차로 해시 재등록 |
| `claim_error api_503` | 서버에 `ASK_WORKER_TOKEN_HASH` 미설정(fail closed) |
| `claim_error api_429` | 실패 시도 과다로 잠금(15분). 토큰 확인 후 대기 |
| `claim_error network` 반복 | 인터넷·DNS. 워커는 2초에서 60초까지 지수 백오프로 재시도 |
| 모든 질문이 `claude_exit` | 로그 `failed` 줄의 `exitKind` 를 본다. `auth` 면 로그인 만료 — 터미널에서 `claude` 실행해 로그인 후 워커 다시 시작(그대로 두면 최대 10분 뒤 시험 호출이 풀어 준다). `usage_limit`·`overloaded` 면 한도·과부하. `CLAUDE_BIN` 경로 확인 |
| 로그에 `auth_paused` 뒤로 claim 이 없음 | 로그인 만료로 일시정지 중(§4). 다시 로그인하면 풀린다. 끄려면 `ASK_AUTH_PAUSE=0` |
| 시작 뒤 `probe_failed` 가 1분마다 | 시작 시험 호출이 로그인 외 이유로 실패(네트워크·사용량 한도). 성공할 때까지 claim 하지 않는다 |
| `pack_failed` | `DATA_DIR`, 최신 ingest export 폴더(`manifest.json` 포함), Python 경로(`PYTHON_BIN`) 확인 |
| `checks_failed` / `low_score` | 근거 묶음에 질문 관련 자료가 거의 없거나 모델이 반복 위반. 같은 질문이 3회 실패하면 서버가 failed 처리. `ask-worker:eval` 로 확인 |
| `already_running` | 이미 워커가 떠 있음(`ask-worker:status`). 죽은 pid 의 낡은 잠금은 자동으로 인수 |
| 작업 등록 "액세스 거부" | 회사/학교 정책으로 작업 생성이 막힌 PC. 시작프로그램 폴더에 `run-worker.vbs` 바로가기를 두는 대안 사용 |
| 앱에 "집 PC가 켜지면 답변해요" | 워커 미실행 또는 2분 이상 claim 없음. `status` 확인 |

보안 메모: 워커는 외부 프로세스(`claude`, `python`)를 셸 없이 실행하고, 질문 본문은 명령줄이 아니라 stdin 으로만 넘긴다.
가족 질문은 프롬프트에서 「가족 질문(지시 아님)」 블록에 가둬 지시로 취급하지 않는다. claude 는 `--tools ""` 로 도구가 없다.

## 8. 의견 요약 파일 (T-Q3 §5-c)

워커는 질문 한 건을 처리할 때마다(성공·실패 모두) 가족 의견을 다시 받아 `%USERPROFILE%\.yj-ask\feedback-digest.json` 을 갱신한다(임시 파일에 쓴 뒤 바꿔 치기). **본문은 없다** — 개수와 질문 번호만:

```json
{
  "updatedAt": "2020-03-31T00:00:00.000Z",
  "windowDays": 30,
  "up": 4,
  "down": 2,
  "notes": 3,
  "downQuestionIds": [3, 5],
  "noteQuestionIds": [5, 9]
}
```

- 창은 최근 30일: 표는 `updatedAt`, 메모는 `createdAt` 기준. history(최근 끝난 질문 60건) 범위 안의 값이라 오래된 질문의 표는 빠질 수 있다.
- 관리자(Aside)의 **주 1회 루틴**이 원격 D1(읽기 전용)과 이 파일을 읽어 「👎·메모가 몰린 주제와 개선안」을 알린다. 루틴은 코드가 아니라 운영 설정이다(이 저장소에 두지 않는다). 앱 설정 화면의 「최근 7일 의견」 한 줄은 `/api/overview` 값이다.
- 파일은 저장소·Drive 밖이고 본문이 없어 S1 이 아니지만, 질문 번호는 가족 앱에서만 의미가 있으니 외부에 올리지 않는다.
