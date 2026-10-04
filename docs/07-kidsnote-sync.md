# 07. 키즈노트 동기화·적재 파이프라인

## 1. 원칙
- 키즈노트 **세션 쿠키를 저장하거나 클라우드로 보내지 않는다.** 관리자 PC 의 로그인된 브라우저 안에서 API 를 호출해 내려받는다.
- 기존 비공개 파이프라인(`$DATA_DIR/_source/build_md.py` 등)이 **정본 생성기**다. 이 저장소는 그 결과를 검증·적재만 한다(ADR-0005).
- 한 단계라도 실패하면 **다음 단계로 가지 않는다**(부분 적재 금지).

## 2. 전체 흐름

```
[1 수집]  브라우저(키즈노트 로그인) → /api/v1_2/children/{id}/reports 전량 + 댓글(v1)
            → $DATA_DIR/_source/raw/YYYY-MM-DD.json   (가정 PC, 비공개)
[2 대조]  기존 `$DATA_DIR/_source/kidsnote_*_reports.json` 과 id 단위 비교
            기존 건 변경/삭제 ≥1 → 중단·보고 (F5-2)   신규만 뒤에 추가
[3 생성]  python _source/build_md.py → alrimjang/
          python _source/download_media.py (선택, R2 미적재)
[4 하류]  tracking → guide → wiki → report 재빌드 (기존 스크립트)
[5 검증]  기존 verify_* 전부 + 독립 재읽기(원본 JSON ↔ .md 줄 단위)
[6 적재]  yj-notes-app/tools/ingest: export → verify → upload
[7 확인]  /api/health 의 lastIngestAt, /api/overview 건수 = 원본 건수
```

## 3. 실행 방식 (단계별 자동화)

| 단계 | 방식 | 상태 |
|---|---|---|
| v1 (M4) | 관리자가 Aside 에 "알림장 업데이트" 요청 → 1~6 수행(2026-09-28 수동 수행 절차를 그대로 스크립트화) | 1차 목표 |
| v2 (M6+) | Aside 주간 루틴(일요일 21시): 브라우저 세션으로 1~6 → 결과 알림. 키즈노트 로그아웃 상태면 알림만 보내고 중단 | 결정 D-06 후 |
| 기각 | 클라우드 크론이 키즈노트에 직접 로그인 | 비밀번호·쿠키를 클라우드에 둬야 함, 약관·차단 위험 |

## 4. `tools/ingest` CLI 계약

```
npm run ingest:export                      # DATA_DIR(읽기 전용) -> %LOCALAPPDATA%\yj-notes\ingest\<run-id>\ 에 SQL + manifest.json
npm run ingest:verify                      # 가장 최근 run 을 원본과 대조(F1~F3, I1~I8) -> verify.json
npm run ingest:upload -- --local           # 로컬 D1(.wrangler/state). 연습·검증용
npm run ingest:upload -- --remote --yes    # 운영 D1 (관리자 PC 만, 적재 토큰 필요)
npm run ingest:status -- --remote          # 원격 건수 vs manifest 건수, 마지막 ingest_run
# 위는 python -m tools.ingest {export|verify|upload|status} 의 래퍼(tools/ingest/run.ts 가 Python 3.11+ 를 찾는다)
# 공통 옵션: --data-dir(기본 환경변수 DATA_DIR) --config --out <run 폴더> --out-root <run 들의 부모> / export: --run-id --force
```

- 언어: **Python 3.11+ (표준 라이브러리만, 런타임 의존성 0)**. xlsx 는 `tools/ingest/xlsx.py`(zip+XML)로 읽는다. 개발 도구(pytest·ruff)는 `tools/ingest/requirements-dev.txt`. CI 는 `setup-python` + `ruff` + `pytest`.
- **출력은 항상 저장소·DATA_DIR 밖**(`%LOCALAPPDATA%\yj-notes\ingest\<run-id>\`, run-id = `UTC시각-내용해시8`). 저장소 안·DATA_DIR 안 경로는 거부한다. `.ingest/` 도 `.gitignore`(G1) 대상.
- export 는 **결정적**이다: 같은 입력 → 바이트 단위 같은 출력(정렬·LF·고정 id). manifest 에는 시각이 없다. 테스트가 두 번 export 해 바이트를 비교한다.
- 폴더 구조는 코드 상수가 아니라 기본 패턴 + 저장소 밖 설정 파일(`--config` > 환경변수 `INGEST_CONFIG` > `<DATA_DIR>/ingest.config.json`)이다. 실제 파일명(아이 이름 포함 가능)은 코드·fixture 에 없다.
- SQL 은 테이블별·**조각**(`NN_<table>.NNN.sql`, 조각당 ≤ 약 200KB·400문장)으로 나뉜다. D1 한도(문장 100KB, 행 2MB)를 넘는 긴 문자열 칸은 `INSERT` 뒤 `UPDATE … SET c = c || '…' WHERE pk = …` 로 40KB 씩 이어 붙인다(적재 후 `SUM(LENGTH(칸))` 를 manifest 와 대조해 온전함을 확인). D1 은 `UNION ALL` 항 수도 제한하므로 건수 조회는 한 행 스칼라 하위 쿼리다.
- **upload 순서**: `verify.json` 이 통과이고 manifest·SQL 해시가 그대로인지 재확인 → 모든 문장을 화이트리스트 검사(허용 형태: `DELETE FROM t;`, `INSERT INTO t (정의된 칸) VALUES (…);`, 위의 `UPDATE`; 허용 테이블 9개) → `ingest_run(status='running')` → `00_delete.sql`(자식 테이블부터 전체 삭제) → 테이블별 `INSERT` → 건수·글자 수 재확인(I7) → `report_doc.verify_ok = 1`(**문서별**: manifest `verified_slugs` — 그 문서가 속한 계층의 검증기가 통과한 문서만, R1-7) → `ingest_run(status='ok', finished_at)`(= `/api/health` 의 `lastIngestAt`). 어느 단계든 실패하면 `failed` 로 남기고 멈춘다. 같은 입력으로 다시 실행하면 대상 테이블 전체 교체라 **멱등**(결과 동일, `ingest_run` 행만 늘어남). D1 은 SQL 파일 안 `BEGIN/COMMIT` 을 받지 않으므로 단일 트랜잭션이 아니다: 삭제 이후 실패하면 대상 테이블이 비거나 일부일 수 있다 → 재실행 또는 D1 Time Travel(`09` R-02).
- **가족 기록(`family_log`)은 적재 대상이 아니다.** 앱이 정본이며 적재가 절대 지우지 않는다. 화이트리스트(`tools/ingest/sqlgen.py` 의 `TABLES`)에 없는 테이블(`family_log`·`auth_attempt`·`app_setting`·`log_type`·`ingest_run`)을 건드리는 문장은 export·verify·upload 세 곳에서 거부된다(테스트: 적재 중 실행된 모든 SQL 에 이 이름이 없음, 적재 전후 행 동일).
- 검진(S2)은 `records/영유아검진/*.xlsx`(같은 열의 csv 도 가능)의 시트 `검진결과` 를 읽어 `checkup`·`measurement` 로 적재한다(`source_image_key` = NULL). **원본 사진(jpg)과 `_source/media` 는 이번 범위에서 적재하지 않는다**(R2 `s2/` 는 M4).
- 문서 원문(`guide/`·`wiki/`·`tracking/` 의 `*.md`, `report/` 의 `*.html`·`*.md`; 빌드 입력 `report/base.html` 제외)은 `report_doc.body` 에 넣는다(마이그레이션 `0004_report_doc_body.sql`, R2 활성화 전 임시 위치). `r2_key` 는 `''`. 목록 카드 설명 `summary`(≤200자, `src/lib/docSummary.ts` 규칙의 파이썬 이식 `tools/ingest/summary.py`)도 적재 때 계산해 넣는다(마이그레이션 `0007_report_doc_summary.sql`, R1-10). `sha256` 은 원본 바이트의 해시다.

### 원본 → 테이블 대응

| 테이블 | 원본 | 메모 |
|---|---|---|
| `note_day` | 알림장 JSON (`_source/kidsnote_*_reports.json`) | 날짜별 1행. `age_months` 는 `meta.birth` 로 계산(일자 md 의 월령과 verify 가 대조). `first_line` 은 그날 첫 알림장 본문 첫 줄 |
| `note_item` | 같은 JSON `reports[]` | `author_role` = `author_name` 의 마지막 낱말(실명 저장 안 함). 방향: 엄마/아빠로 끝나면 `to_center`. `weather` 는 기존 빌더의 한국어 값, 미기재는 NULL. `posted_at` = UTC+9, 분 단위. `body` = CRLF→LF·앞뒤 공백 제거(기존 `build_md.py` 와 같은 규칙) |
| `note_comment` | `reports[].comments[]` | 원본에 댓글 id 가 없다 → `id = report_id*1000 + 순번`(시각 순, 같은 시각은 원본 순). 작성자 이름은 저장하지 않음 |
| `milestone` | `evidence/milestones.csv` | 5개 칸만 |
| `observation` | `tracking/observations.csv` | `id` = 파일 행 순번, `subject_near` YES/NO → 1/0. 패턴 칸은 스키마에 없어 버림 |
| `growth_ref` | `evidence/growth.csv` | 스키마의 L·M·S·p3·p50·p97 만(`NA` → NULL). 다른 백분위·단위 칸은 담지 않음(필요하면 마이그레이션) |
| `checkup`·`measurement` | 검진 결과 표 | 값·판독상태·비고를 원문 그대로. `condition_note` = 표의 `근거·비고`. 결과지에 없는 값은 NULL, 판정 문구는 만들지 않음 |
| `report_doc` | 문서 파일 | 제목 = 마크다운 첫 `# `, HTML `<title>`. `generated_at` = 파일 수정일(UTC), `source_commit` = DATA_DIR 의 git HEAD(없으면 `unknown`) |

### 계층별 검증기 (R1-7)
- export 가 `DATA_DIR` 안의 `tracking/verify_tracking.py`·`guide/verify_guide.py`·`wiki/verify_wiki.py`·`report/verify_report.py`·`evidence/verify_evidence.py` 를 **적재 도구와 같은 파이썬**으로 한 번씩 실행(실행 폴더 `DATA_DIR`, 제한 300초, 출력 버림, 종료 코드만 사용)하고 `manifest.layers` 에 계층별 `pass|fail|missing|error` 를 남긴다. 검증기가 없거나 `DATA_DIR` 밖을 가리키면 `missing`(통과 아님).
- 문서의 계층은 경로 첫 폴더. 통과한 계층의 문서만 `verify_ok=1`, 나머지는 0. export 는 실패해도 멈추지 않고 `ingest verify` 가 `[WARN] L1` 로 계층 이름을 알린다(종료 코드는 0).

### verify 검사 목록
| ID | 검사 |
|---|---|
| F1 | export 파일 해시 = manifest, manifest 에 없는 SQL 없음 |
| F2 | 모든 SQL 문장이 허용 형태·화이트리스트 테이블이고 금지 테이블(`family_log`·`auth_attempt`·`app_setting`·`log_type`) 없음, SQL 문법(따옴표·주석) |
| F3 | 임시 DB(스키마 + 마이그레이션)에 적용: 중복 키 0, NOT NULL·CHECK 통과, 외래 키 위반 0(F3b), 필수 칸 비어 있지 않음(F3c; 본문·첫 줄은 빈 값 허용) |
| I1 | 알림장 일수·건수·댓글 수 = 원본 JSON = 일자 md 합계 |
| I2 | 모든 본문·댓글이 SQL 에 온전히 있고, 모든 줄이 일자 md 에 존재(기존 §5 검증과 같은 강도) |
| I3 | 관측 스니펫이 해당 날짜 일자 md(또는 SQL 본문)에 존재. 스니펫이 md 에서 떼어 낸 것이라 댓글 머리줄·마크다운 기호를 포함한다(실제 자료로 확인: JSON 본문만 보면 일부가 빠진다) |
| I4 | 문서 sha256 = 원본 파일 해시 = 적재 body 의 해시, 그리고 export 이후 원본이 바뀌지 않음(읽은 파일 전부 재해시) |
| I5 | 교사·보호자 실명이 export 결과 `author_role` 에 없음(원본 `author`·댓글 `name` 에서 이름 집합을 만들어 포함 여부 확인) |
| I6 | S2 키는 `s2/` 접두어만, 사진·영상 파일이 입력에 없음 |
| I7 | 적용 DB 건수 = manifest 건수. **원격 적재 후 건수 = manifest 건수** 는 `upload` 가 끝에서, `status` 가 언제든 같은 비교로 확인 |
| I8 | 날짜 범위 = 원본(일자 md 일수 포함), `age_months` = 일자 md 월령 |

## 4-1. 관리자용 원격 적재 순서 (운영 D1)

전제: 관리자 PC, 적재 토큰(`CLOUDFLARE_API_TOKEN`, D1 편집)이 환경변수에 있음, `npm ci` 완료, `DATA_DIR` 설정. 수집·하류 재빌드(§2 단계 1~5)가 끝난 뒤다.

| # | 명령 | 확인 |
|---|---|---|
| 1 | `npm run db:migrate:prod` (새 마이그레이션이 있을 때만. 최초에는 `0004_report_doc_body.sql`·`0007_report_doc_summary.sql` 포함) | 출력에 적용 목록 |
| 2 | `npm run ingest:export` | 건수·날짜 범위가 원본(알림장 일수·알림장 건수·댓글 수)와 같은지 |
| 3 | `npm run ingest:verify` | `verify 통과`. 실패면 여기서 멈춘다(다음 단계 금지) |
| 4 | `npm run ingest:upload -- --local` (선택, 최초 1회 권장) | 로컬 D1 에서 건수 일치 |
| 5 | `npm run ingest:upload -- --remote --yes` | `ingest_run #N ok` 출력 |
| 6 | `npm run ingest:status -- --remote` | `matches_manifest: true`, `last_run.status: ok` |
| 7 | 브라우저에서 `/api/health` 의 `lastIngestAt` 갱신, 홈의 건수 = 원본 건수 | `07` §2 단계 7 |

- 5번이 중간에 실패하면 `ingest_run` 이 `failed` 로 남는다. 대상 테이블이 비어 있을 수 있으니 **같은 run 폴더로 5번을 다시 실행**하고(멱등), 안 되면 `09` R-02(Time Travel).
- `family_log` 는 어느 단계에서도 변하지 않는다. 의심스러우면 5번 전후로 `SELECT COUNT(*) FROM family_log` 를 비교한다.
- export 이후 원본을 고치면 verify(I4)가 실패한다 → export 부터 다시.
- 한 번 upload 는 파일당 wrangler 호출이라 수 분 걸린다(실측: 로컬 약 2분).

## 5. 실패 시 메시지 예
- `[2 대조] 기존 알림장 1건이 수정됨 (report 1000000001, 2020-03-02 본문 3번째 줄). 적재 중단. 차이: …` → 관리자가 확인 후 `--accept-upstream-edit 1000000001` 로 재실행.
