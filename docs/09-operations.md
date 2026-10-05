# 09. 운영

## 1. 환경

| 환경 | Pages 프로젝트 | D1 | R2 | 자료 |
|---|---|---|---|---|
| local | `wrangler pages dev` | 로컬(Miniflare) | 로컬 | fixtures 만 |
| preview | PR 미리보기 | `yj-notes-db-preview` | `yj-notes-private-preview` | fixtures 만 |
| production | `yj-notes-app` (production 브랜치 `main`) | `yj-notes-db` (ID 는 `wrangler.toml`) | `yj-notes-private` — **M4 활성화 예정**(R2 미사용, 바인딩 주석 처리) | 실제(S1/S2) |

- 미리보기 환경에는 **실제 자료를 절대 적재하지 않는다**(PR 미리보기 주소는 추측 가능). 미리보기 자원은 M2 이후 만든다. **R1-8**: `wrangler.toml` 의 `[env.preview]` 는 운영 D1 에 묶이지 않도록 별도 D1(`yj-notes-db-preview`)을 명시하며, 실제 자원을 만들기 전까지 `database_id` 는 존재하지 않는 자리표시자(`0000…`)다 — 미리보기는 DB 에 닿지 못해 실패할 뿐 운영 자료에 닿지 않는다. 자원을 만든 뒤 그 ID 로 바꾼다(운영 ID 재사용은 `tests/security/deploy-config.test.ts` 가 막는다). 또 `deploy.yml` 의 수동 실행(`workflow_dispatch`)은 `main` 브랜치에서 실행했을 때만 배포한다(다른 브랜치는 건너뜀).

## 2. 비밀값

| 이름 | 위치 | 교체 주기 |
|---|---|---|
| `PIN_HASH`, `PIN_SALT` | Cloudflare Pages secret | PIN 변경 시 |
| `SESSION_SECRET` | Cloudflare Pages secret | 6개월 또는 사고 시 |
| `IP_HASH_SALT` | Cloudflare Pages secret | 1년 |
| `ASK_WORKER_TOKEN_HASH` (선택, 물어보기 워커용) | Cloudflare Pages secret | 1년 또는 집 PC 침해 시 |
| `CLOUDFLARE_API_TOKEN` (배포용, Pages 편집만) | GitHub Actions secret | 1년 |
| `CLOUDFLARE_API_TOKEN` (적재용, D1·R2 편집) | 관리자 PC 환경변수만 | 1년 |

- `PIN_LENGTH`(선택, 4~12): 로그인 화면이 이 자릿수에서 자동 전송한다. 비밀은 아니지만 운영 값은 Pages secret 으로 둔다(저장소·`wrangler.toml` 에 쓰지 않음). 그 밖의 값·미설정이면 4~12자리 + '확인' 방식.
- `ASK_WORKER_TOKEN_HASH`(선택, T-Q): 집 PC 워커 Bearer 토큰의 **SHA-256 hex**(64자). 토큰 원본은 서버에 두지 않는다. 생성: 관리자 PC 에서 32바이트 이상 무작위 토큰을 만들고(예: `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`) 같은 값을 워커 `worker.env` 의 `ASK_WORKER_TOKEN` 에 넣은 뒤, 그 SHA-256 hex 를 `npx wrangler pages secret put ASK_WORKER_TOKEN_HASH --project-name yj-notes-app` 로 등록하고 **재배포**한다. 값이 없거나 형식이 틀리면 `/api/worker/*` 는 전부 503(워커 연결 꺼짐, 앱의 다른 기능은 영향 없음). 교체·폐기: 새 해시 등록 후 재배포(이전 토큰 즉시 무효). 자세한 위협 모델은 `04` §3-2.
- 배포 토큰과 적재 토큰을 **분리**한다. GitHub 에는 D1·R2 권한이 없는 토큰만 둔다.
- **PIN 자릿수 설정(관리자)**: PIN 을 바꾸거나 처음 정할 때 자릿수도 맞춘다. `npx wrangler pages secret put PIN_LENGTH --project-name yj-notes-app` (예: 6 입력) 후 **재배포**해야 반영된다. 자릿수와 실제 PIN 길이가 다르면 로그인할 수 없으니 `PIN_HASH`·`PIN_SALT` 와 같은 순서로 함께 바꾼다.
- **PIN 규칙(R1-1)**: PIN 은 **무작위 6자리 이상**(6~12)이어야 하고 생일·전화번호는 안 된다. `pin:hash` 는 6자리 미만을 거부한다.
- PIN 해시 생성: `npm run pin:hash` (로컬에서 입력, 화면 출력만, 파일 저장 안 함). 출력에는 `PIN_SALT`·`PIN_HASH` 와 함께 **입력한 PIN 의 자릿수**(`PIN_LENGTH=<n>`, PIN 자체는 아님)와 세 값의 등록 명령이 나온다.
- **경고: `PIN_LENGTH` 가 실제 PIN 길이와 다르면 아무도 로그인할 수 없다**(자동 전송 화면이 틀린 자리에서 보내거나 끝내 보내지 않는다). `PIN_SALT`·`PIN_HASH`·`PIN_LENGTH` 를 함께 등록하고 **재배포**한다. 화면은 PIN 이 연달아 3번 틀리면 「자릿수 설정을 관리자에게 물어봐 주세요」 라고 알린다(잠금과는 별개). R-01 에서 먼저 이 설정을 확인한다.

## 3. 배포
- 코드: `main` 병합 → `deploy.yml` → Pages production. 실패 시 Cloudflare 대시보드에서 이전 배포로 **롤백(1클릭)**.
- 스키마: `migrations/` 새 파일 → `npm run db:migrate:prod`(관리자 PC, 적재 토큰) → 코드 배포. **역방향 호환 마이그레이션만**(열 추가 O, 삭제는 두 단계로).
- 자료: `07` 파이프라인.

### 3-1. 최초 배포 절차 (관리자)
1. Cloudflare 대시보드 > Workers & Pages > Create > Pages > **Direct Upload** 로 프로젝트 `yj-notes-app` 생성, production 브랜치 `main`.
2. 운영 DB 마이그레이션(적재 토큰 환경): `npm run db:migrate:prod`
3. 비밀값 설정(각각 입력 프롬프트에 붙여넣기). 값 생성(화면 출력만, 파일 저장 없음):
   - PIN: `npm run pin:hash` → 출력된 `PIN_SALT`, `PIN_HASH`
   - 무작위 값(두 번 실행해 각각 사용): `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`
   - 등록: `npx wrangler pages secret put PIN_HASH --project-name yj-notes-app` (같은 방식으로 `PIN_SALT`, `SESSION_SECRET`, `IP_HASH_SALT`)
4. GitHub 저장소 Settings > Secrets and variables > Actions 에 `CLOUDFLARE_API_TOKEN`(권한 **Account > Cloudflare Pages: Edit** 만), `CLOUDFLARE_ACCOUNT_ID` 등록. Settings > Environments 에 `production` 생성(필요하면 승인자 지정). 비밀값이 없으면 `deploy.yml` 은 "배포 비밀값 미설정 — 건너뜀" 을 알리고 성공 종료한다(배포 안 함).
5. **O-03**: 대시보드 > Workers & Pages > `yj-notes-app` > Settings > Runtime > **Fail open/closed → "Fail closed"**.
6. 첫 배포: `main` 병합 후 `deploy.yml` 자동 실행(또는 Actions 에서 수동 실행). 급하면 관리자 PC 에서 `npm run deploy:prod`.
7. 확인: `https://yj-notes-app.pages.dev/api/health` 가 200, `/robots.txt` 가 `Disallow: /`, 로그인 전 `/api/*` 가 401.
8. R2 는 M4 에서 대시보드 R2 활성화 후 `wrangler.toml` 의 `FILES` 주석 해제.

### 3-1b. 자료 적재 (관리자, 매번 동일)
`DATA_DIR` 설정 + 적재 토큰 환경에서(자세한 설명·표는 `07` §4-1):
```
npm run ingest:export
npm run ingest:verify                     # 통과해야 다음으로
npm run ingest:upload -- --remote --yes
npm run ingest:status -- --remote         # matches_manifest: true
```
- 새 마이그레이션이 있으면 먼저 `npm run db:migrate:prod`(순서는 §3-1d). `upload` 는 시작 전에 필요한 마이그레이션(`0007_report_doc_summary.sql` 이상: 문서 원문 `body` 칸(0004)과 목록 설명 `summary` 칸(0007))이 적용됐는지 확인하고, 안 됐으면 명확한 오류로 멈춘다.
- 출력은 `%LOCALAPPDATA%\yj-notes\ingest\<run-id>\`(저장소 밖, S1·S2 포함). 적재가 끝나면 오래된 run 폴더는 지워도 된다.
- `--remote` 는 `--yes` 없이는 동작하지 않는다. 개발·검증은 `--local` 로(`npm run db:migrate:local` 이 선행).
- Python 3.11+ 가 필요하다(런타임 패키지 없음). 없으면 `INGEST_PYTHON` 에 경로를 지정한다.

### 3-1c. 아이 설정값 (관리자, 1회)
성장 곡선이 월령·기준표를 고르는 값은 저장소·마이그레이션에 **넣지 않는다**(공개 저장소). 관리자가 운영 DB 에 직접 넣는다. 값은 자리표시이며, 실제 값은 이 문서·커밋·로그에 적지 않는다.
```
wrangler d1 execute DB --remote --command "INSERT OR REPLACE INTO app_setting (key, value) VALUES ('child_birth_date', '<YYYY-MM-DD>')"
wrangler d1 execute DB --remote --command "INSERT OR REPLACE INTO app_setting (key, value) VALUES ('child_sex', '<F 또는 M>')"
```
- 키가 없을 때: `child_birth_date` 가 없으면 측정 월령 대신 **검진 회차의 개월 수**로 대체한다. `child_sex` 가 없으면 기준표는 `F` 로 읽는다(`M` 일 때만 남아용 기준표). 그래서 성별이 `M` 이면 반드시 넣는다.
- 로컬 개발은 `--remote` 대신 `--local`. 합성 값은 `fixtures/seed/library_health.sql` 에만 있다.

### 3-1d. 새 마이그레이션이 있는 배포 순서 (관리자)
새 마이그레이션이 포함된 배포는 **아래 순서를 지킨다**(마이그레이션 → 자료 → 설정값 → 코드 → 확인). 코드를 먼저 올리면 새 칸이 없어 화면이 오류가 난다.

> 현황: `0004`(문서 원문 칸)·`0005`(기록 스키마·이력)·`0006`(기록 선택지 라벨 정리)·`0007`(목록 설명 `summary` 칸, R1-10)은 **2026-10-04 기준 운영에 적용됨**(CHG-01, §6). 아래 표는 다음 마이그레이션에도 그대로 쓴다.

| # | 명령 (관리자 PC, `DATA_DIR`·적재 토큰 환경) | 확인 |
|---|---|---|
| 1 | `npm run db:migrate:prod` | 이번에 새로 생긴 마이그레이션이 ✅ 로 나온다(현재까지 0004~0007 적용 완료) |
| 2 | `npm run ingest:export` → `npm run ingest:verify` → `npm run ingest:upload -- --remote --yes` | verify 전 항목 OK, upload 가 건수를 출력 |
| 3 | 아이 설정값 INSERT 두 줄(§3-1c: `child_birth_date`, `child_sex`) | `SELECT key FROM app_setting` 에 두 키가 보인다(값은 기록하지 않는다) |
| 4 | `npm run deploy:prod` (또는 `main` 병합) | 배포 성공 |
| 5 | `npm run ingest:status -- --remote` | `matches_manifest: true`. 그리고 앱 홈에서 최근 알림장의 **개월 수**가 실제 나이와 맞는지 눈으로 확인(생일 설정이 반영됐다는 뜻) |

- 2번 `upload` 는 대상 표 전체를 교체한다(멱등). 중간에 실패하면 같은 run 폴더로 다시 실행(R-02).
- 5번에서 `matches_manifest` 가 false 면 자료를 공개된 채로 두지 말고 R-02 순서로 조치한다.
- 이 순서는 새 마이그레이션이 생길 때마다 같다: ①마이그레이션 ②자료 ③설정 ④코드 ⑤확인.
- 확인 시 `0007` 도 빠지지 않았는지 본다: `ingest upload` 는 `0007_report_doc_summary.sql` 이상이 적용되지 않았으면 멈춘다(§3-1b).
### 3-2. Functions 실행 범위와 무료 한도
- 보안 헤더 미들웨어(`functions/_middleware.ts`)를 **모든 요청**(정적 파일 포함)에 적용하려고 `_routes.json` 을 두지 않는다. 따라서 Functions 가 모든 요청에서 실행된다.
- Pages Functions 는 Workers 무료 한도(일 100,000 요청)를 **공유**한다. 정적 파일 요청도 포함되므로 O-04 에서 사용량을 본다.
- `public/robots.txt`(`Disallow: /`)가 빌드 결과 `dist/` 에 포함된다.
## 4. 운영 점검표

| ID | 주기 | 점검 |
|---|---|---|
| O-01 | 배포마다 | CI 녹색, Q-SEC 통과 |
| O-02 | 주 1회 | 마지막 동기화 날짜, `ingest status` 건수 일치 |
| O-03 | 최초·설정 변경 시 | 대시보드 > Workers & Pages > `yj-notes-app` > Settings > Runtime > Fail open/closed → **"Fail closed"**, R2 공개 접근 꺼짐, r2.dev 주소 꺼짐 |
| O-04 | 월 1회 | Cloudflare 사용량(Functions·D1·R2) 무료 한도의 50% 미만 |
| O-05 | 주 1회 | `npm run backup:prod` → `DATA_DIR/backups/d1/yj-notes-db_YYYY-MM-DD.sql` (가족 기록 보호, 저장소 밖) |
| O-06 | 분기 1회 | 복구 연습(로컬 전용, §5-1). 최근: **2026-10-05 통과**(알림장 487일·댓글 734·문서 19 재생성, 앱 표 복원) |
| O-07 | 주 1회 / 반기 1회 | Dependabot PR 검토·병합(주간, minor·patch 묶음) / 비밀값 교체·메이저 버전 업데이트(반기) |

## 5. 런북

| ID | 증상 | 조치 |
|---|---|---|
| R-01 | 가족이 "PIN 이 안 돼요" | 잠금 여부 확인(`auth_attempt`) → 15분 대기 안내. 전역 잠금이면 공격 의심 → 로그 확인 후 PIN 교체. **전체 잠금 기준: 시간당 30회 또는 24시간 100회 실패(R2-1)**. **먼저 설정 화면의 「최근 전체 잠금」 날짜(= `app_setting.last_global_lock_at`, `GET /api/overview` 의 `security.lastGlobalLockAt`)를 확인**한다(R1-3), 같은 곳의 「최근 7일 PIN 실패」 횟수(`security.failures7d`)로 시도 규모를 본다. 반복되면 8자리 이상 PIN 으로 교체를 권한다(`docs/04` §3). **한계**: 외부 알림 채널(메일·푸시)은 없다 — 가족 중 로그인된 사람이 설정 화면에서 보거나 관리자가 D1 을 조회해야 알 수 있다 |
| R-02 | 적재 실패(`ingest_run.status=failed`) — 홈에 「마지막 갱신이 실패했어요」, 적재 중엔 「자료를 갱신하는 중이에요」 안내가 뜬다(R1-6) | 오류 메시지 확인(자료 내용은 출력되지 않음) → **같은 run 폴더로 `upload` 재실행**(대상 테이블 전체 교체라 멱등) → 그래도 안 되면 D1 Time Travel 로 적재 직전 시점 복원(`wrangler d1 time-travel restore`) → 원인 수정 후 재적재 |
| R-03 | 503 quota_exceeded | 사용량 확인. 반복되면 원인(루프 요청 등) 수정. 유료 전환은 관리자 결정 |
| R-04 | 기록이 사라졌다 | `deleted_at` 확인(소프트 삭제 복구) → 없으면 §5-1 의 앱 표 복원(해당 id 만 골라 적용 가능) |
| R-05 | 유출 의심 | `04` §6 절차 |
| R-06 | 키즈노트 수집 실패 | 브라우저 로그인 상태 확인 → API 응답 형식 변경이면 수집 단계 수정, 적재는 보류 |

### 5-1. 백업 복구 절차 (2026-10-05 연습으로 확정)
`wrangler d1 export` 백업은 report_doc 본문을 한 문장으로 써서 `wrangler d1 execute --file` 로 통째로 되넣으면 `SQLITE_TOOBIG`(문장 100KB 초과)으로 실패한다. 그래서 두 갈래로 복구한다.
1. **다시 만들 수 있는 표**(알림장·관측·근거·검진·문서): `npm run db:migrate:prod` → `npm run ingest:export` → `ingest:verify` → `ingest:upload -- --remote --yes` (DATA_DIR 가 정본).
2. **앱에만 있는 표**(`family_log`, `family_log_history`, `ask_question`, `ask_answer`, `ask_feedback`, `app_setting`): `python tools/admin/backup-extract.py <백업.sql> <출력.sql>` → `npx wrangler d1 execute DB --remote --file <출력.sql>`. 출력 파일은 S1 이므로 저장소 밖에 두고 적용 후 지운다. 일시 상태인 `worker_auth_fail` 표와 `app_setting` 의 `session_epoch`·`last_global_lock_at`·`ask_worker_seen_at`·`ask_worker_locked_until` 은 되살리지 않는다.
3. `npm run ingest:status -- --remote --yes` 가 `matches_manifest: true` 인지, 앱에서 기록 목록이 보이는지 확인.
- 7일 이내 사고는 D1 Time Travel(`wrangler d1 time-travel restore`)이 더 빠르다.

## 6. 사고·변경 기록
| 날짜 | ID | 내용 | 조치 | 상태 |
|---|---|---|---|---|
| 2026-09-28 | INC-01 | 현행 정적 사이트 PIN 우회 가능 | 위험 수용(D-03), 신규 앱에서 해소 | 열림 — 신규 앱 운영 개시(2026-10-05), 전환 대기 |
| 2026-10-04 | CHG-01 | 운영 첫 실자료 적재(ingest_run #2, matches_manifest true), Fail closed 설정, GitHub 자동 배포 연결(Pages 편집 전용 토큰) | — | 완료 |
| 2026-10-05 | CHG-02 | 복구 연습: 백업 통째 재적용 불가(SQLITE_TOOBIG) 발견 → §5-1 두 갈래 절차·`backup-extract.py` | — | 완료 |
