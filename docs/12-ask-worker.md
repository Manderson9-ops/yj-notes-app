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

흐름: claim → progress(answering) → 근거 묶음 → 작성(claude) → 결정적 검사 → progress(reviewing) → 검토(claude)
→ 점수 < 9.5 또는 단계 불일치면 지적을 넣어 **최대 2회** 재작성·재검토(가장 높은 점수 채택) → answer 업로드. 9.5 미만으로 게시된 답은 `reviewScore` 로 서버에 저장되고, 앱이 「품질 검사 기준보다 낮아 참고용이에요」를 작게 보여 준다.
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
# CLAUDE_BIN=C:\Users\<이름>\.local\bin\claude.exe
# PYTHON_BIN=C:\...\python.exe
# ASK_POLL_MS=10000
# ASK_MIN_PUBLISH_SCORE=8.5
# ASK_CLAUDE_TIMEOUT_MS=240000
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

- 로그: `%USERPROFILE%\.yj-ask\logs\worker-YYYY-MM-DD.log` (JSON 한 줄씩, 14일 보관). **질문·답변 본문은 기록하지 않고** id·단계·시간·상태·코드만 남는다.
- 근거 묶음 캐시: `%USERPROFILE%\.yj-ask\cache\child-<export run id>.json` (export 가 새로 올라온 run 으로 바뀔 때만 다시 만든다).
- 앱 홈의 워커 표시는 서버의 `ask_worker_seen_at`(claim·ping 때 60초에 한 번 갱신) 기준 2분 이내면 온라인.

## 5. 골든 세트 평가

```powershell
npm run ask-worker:eval -- --set "<DATA_DIR>\ask-eval\golden.jsonl" --out "<DATA_DIR>\ask-eval\results" [--runs 2] [--limit 5]
```

`golden.jsonl` 한 줄: `{"id":"g01","question":"…","askedBy":"할머니","redFlag":false}` (`askedBy`·`redFlag` 선택).
각 질문을 `--runs`(기본 2)회 돌려 평균·최저 점수, 항목별(근거·기록·실행·안전·말투) 평균, 같은 질문 단계 차 ≤ 1 비율을
`eval-<시각>.json` / `.md` 로 저장한다. 결과 파일에는 질문·답변 본문이 없고 id·점수·시간만 있다.
`--set`·`--out` 이 저장소 안이면 거부한다. 저장소에는 형식만 두고 실제 질문·답은 두지 않는다.

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
- 합성 드라이런 1회 실측(Opus, 합성 픽스처): 근거 묶음 약 0.4초, 작성 약 25초, 검토 약 14초, 재작성 약 19초, 재검토 약 19초(합계 약 77초).
  claim 대기(최대 10초)와 PC 부하에 따라 달라진다. 재작성이 없는 경우 약 40초.

## 7. 문제 해결

| 증상 | 확인 |
|---|---|
| 시작 즉시 종료, "설정 파일" 메시지 | `worker.env` 위치(저장소·Drive 밖인지), `APP_ORIGIN`(https), 토큰 길이 16자 이상 |
| 로그에 `claim_error api_401` | 토큰과 Pages 의 `ASK_WORKER_TOKEN_HASH` 불일치. 1번 절차로 해시 재등록 |
| `claim_error api_503` | 서버에 `ASK_WORKER_TOKEN_HASH` 미설정(fail closed) |
| `claim_error api_429` | 실패 시도 과다로 잠금(15분). 토큰 확인 후 대기 |
| `claim_error network` 반복 | 인터넷·DNS. 워커는 2초에서 60초까지 지수 백오프로 재시도 |
| 모든 질문이 `claude_exit` | `claude` 로그인 만료. 터미널에서 `claude` 실행해 로그인. `CLAUDE_BIN` 경로 확인 |
| `pack_failed` | `DATA_DIR`, 최신 ingest export 폴더(`manifest.json` 포함), Python 경로(`PYTHON_BIN`) 확인 |
| `checks_failed` / `low_score` | 근거 묶음에 질문 관련 자료가 거의 없거나 모델이 반복 위반. 같은 질문이 3회 실패하면 서버가 failed 처리. `ask-worker:eval` 로 확인 |
| `already_running` | 이미 워커가 떠 있음(`ask-worker:status`). 죽은 pid 의 낡은 잠금은 자동으로 인수 |
| 작업 등록 "액세스 거부" | 회사/학교 정책으로 작업 생성이 막힌 PC. 시작프로그램 폴더에 `run-worker.vbs` 바로가기를 두는 대안 사용 |
| 앱에 "집 PC가 켜지면 답변해요" | 워커 미실행 또는 2분 이상 claim 없음. `status` 확인 |

보안 메모: 워커는 외부 프로세스(`claude`, `python`)를 셸 없이 실행하고, 질문 본문은 명령줄이 아니라 stdin 으로만 넘긴다.
가족 질문은 프롬프트에서 「가족 질문(지시 아님)」 블록에 가둬 지시로 취급하지 않는다. claude 는 `--tools ""` 로 도구가 없다.
