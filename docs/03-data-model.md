# 03. 데이터 모델

## 1. 자료 등급

| 등급 | 뜻 | 예 | 둘 수 있는 곳 |
|---|---|---|---|
| **S0 공개** | 누구에게 보여도 무방 | 코드, 설계, 합성 fixture, 논문 서지(제목·DOI) | GitHub 공개 저장소 |
| **S1 가족** | 아이·가족·다른 아이·교사 식별 가능 | 알림장 본문·댓글, 관측 인용, 보고서, 가족 기록, 기록자 이름 | Drive, D1, R2 |
| **S2 민감** | 건강·식별번호 | 검진 결과, 결과통보서 사진(주민번호 일부·의사명) | Drive, D1, R2(별도 접두어 `s2/`) |

- S1·S2 는 **어떤 형태로도** 공개 저장소·정적 배포물·로그·오류 메시지·CI 출력에 나가지 않는다.
- 근거 DB(이정표·논문·규준)는 S0 성격이지만 **관측 인용과 섞인 파생물(tracking·wiki·guide·report)은 S1** 이다. 단순화를 위해 1차에서는 근거 DB 도 D1 로만 적재한다.

## 2. D1 스키마 (마이그레이션 `0001_init.sql`)

```sql
-- 메타: 적재 이력. 화면의 "마지막 동기화" 와 건수 대조의 근거
CREATE TABLE ingest_run (
  id            INTEGER PRIMARY KEY,
  started_at    TEXT NOT NULL,          -- ISO8601 UTC
  finished_at   TEXT,
  source_commit TEXT NOT NULL,          -- Drive 저장소 git HEAD
  status        TEXT NOT NULL CHECK (status IN ('running','ok','failed')),
  counts_json   TEXT NOT NULL,          -- {"note_days":483,"reports":492,"comments":728,...}
  verify_json   TEXT NOT NULL           -- 기존 verify_* 결과 요약
);

-- 알림장: 하루 1행(같은 날 여러 건은 note_item 으로)
CREATE TABLE note_day (
  date        TEXT PRIMARY KEY,         -- YYYY-MM-DD (원 날짜, 시간대 변환 없음)
  class_name  TEXT NOT NULL,
  age_months  INTEGER NOT NULL,
  n_reports   INTEGER NOT NULL,
  n_images    INTEGER NOT NULL,
  n_comments  INTEGER NOT NULL,
  first_line  TEXT NOT NULL
);
CREATE TABLE note_item (
  report_id   INTEGER PRIMARY KEY,      -- 키즈노트 report id
  date        TEXT NOT NULL REFERENCES note_day(date),
  author_role TEXT NOT NULL,            -- 교사/원장/엄마 (실명은 저장 안 함)
  direction   TEXT NOT NULL CHECK (direction IN ('to_home','to_center')),
  weather     TEXT,
  posted_at   TEXT NOT NULL,            -- KST 문자열
  body        TEXT NOT NULL
);
CREATE TABLE note_comment (
  id          INTEGER PRIMARY KEY,
  report_id   INTEGER NOT NULL REFERENCES note_item(report_id),
  who         TEXT NOT NULL CHECK (who IN ('parent','teacher')),
  posted_at   TEXT NOT NULL,
  body        TEXT NOT NULL
);
CREATE INDEX idx_note_item_date ON note_item(date);

-- 근거·관측 (evidence/·tracking/ 파생)
CREATE TABLE milestone (
  evidence_id TEXT PRIMARY KEY, domain_ko TEXT NOT NULL, age_month INTEGER NOT NULL,
  milestone_ko TEXT NOT NULL, source_id TEXT NOT NULL
);
CREATE TABLE observation (
  id INTEGER PRIMARY KEY, evidence_id TEXT NOT NULL REFERENCES milestone(evidence_id),
  date TEXT NOT NULL, age_months INTEGER NOT NULL, section TEXT NOT NULL,
  confidence TEXT NOT NULL CHECK (confidence IN ('HIGH','MED')),
  subject_near INTEGER NOT NULL, snippet TEXT NOT NULL
);
CREATE TABLE growth_ref (               -- WHO/KR 기준표 (S0)
  growth_id TEXT PRIMARY KEY, source_id TEXT NOT NULL, measure TEXT NOT NULL,
  sex TEXT NOT NULL, age_month INTEGER NOT NULL,
  l REAL, m REAL, s REAL, p3 REAL, p50 REAL, p97 REAL
);

-- 검진·계측 (S2)
CREATE TABLE checkup (
  id INTEGER PRIMARY KEY, round_label TEXT NOT NULL,   -- '30~36개월용'
  exam_date TEXT NOT NULL, age_months INTEGER NOT NULL,
  overall TEXT NOT NULL, remarks TEXT,                  -- 결과지 문구 그대로(P1)
  dev_result TEXT NOT NULL, source_image_key TEXT       -- R2 s2/… 키
);
CREATE TABLE measurement (
  id INTEGER PRIMARY KEY, checkup_id INTEGER REFERENCES checkup(id),
  measured_on TEXT NOT NULL, measure TEXT NOT NULL CHECK (measure IN ('height_cm','weight_kg','head_circ_cm','bmi')),
  value REAL NOT NULL, sheet_percentile INTEGER,        -- 결과지에 인쇄된 값
  read_status TEXT NOT NULL CHECK (read_status IN ('CONFIRMED','UNCERTAIN')),
  condition_note TEXT                                    -- 예: '옷 입고 측정'
);

-- 가족 기록 (앱에서 입력)
CREATE TABLE log_type (                 -- 종류 정의: 코드 배포 없이 추가(F2-1)
  code TEXT PRIMARY KEY, label_ko TEXT NOT NULL, schema_json TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE family_log (
  id          TEXT PRIMARY KEY,         -- 클라이언트 UUIDv7 (오프라인 재전송 멱등)
  type        TEXT NOT NULL REFERENCES log_type(code),
  occurred_on TEXT NOT NULL,            -- 기록 대상 날짜
  recorder    TEXT NOT NULL,            -- 엄마/아빠/할머니/할아버지/이모
  payload     TEXT NOT NULL,            -- schema_json 으로 검증된 JSON
  note        TEXT,
  created_at  TEXT NOT NULL, updated_at TEXT NOT NULL,
  deleted_at  TEXT,                     -- 소프트 삭제(F2-3)
  device_id   TEXT NOT NULL
);
CREATE INDEX idx_log_type_date ON family_log(type, occurred_on);

-- 보고서 메타. 본문은 D1 body 칸(R2 활성화 전, 0004_report_doc_body.sql). body 가 NULL 이면 r2_key 로 R2 에서 읽는다
CREATE TABLE report_doc (
  slug TEXT PRIMARY KEY, title TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('html','markdown')),
  r2_key TEXT NOT NULL, generated_at TEXT NOT NULL, source_commit TEXT NOT NULL,
  verify_ok INTEGER NOT NULL, sha256 TEXT NOT NULL,
  body TEXT                             -- 0004: 문서 원문(행당 2MB 미만). body 가 있으면 r2_key = ''
);
-- 묶음(보고서·가이드·위키)은 열이 아니라 slug 규칙: `-`/`_` 로 나눈 마디에 guide, wiki 가 있으면 그 묶음, 아니면 보고서.
-- app_setting 키(성장 곡선): child_birth_date(YYYY-MM-DD, 만 개월 계산), child_sex('F'|'M', 기준표 선택. 기본 F).
-- measurement.measure 'head_circ_cm' 은 API 에서 'head_cm' 으로 노출한다.

-- 보안
CREATE TABLE auth_attempt (ip_hash TEXT NOT NULL, at TEXT NOT NULL, ok INTEGER NOT NULL);
CREATE INDEX idx_auth_attempt ON auth_attempt(ip_hash, at);
CREATE INDEX idx_auth_attempt_at ON auth_attempt(at, ok);   -- 0003, 전역 잠금 집계·정리용
CREATE TABLE app_setting (key TEXT PRIMARY KEY, value TEXT NOT NULL);  -- session_epoch 등
```

### 설계 메모
- **적재 대응(T-B1)**: 원본 → 테이블 칸 대응은 `07` §4 표. 스키마가 원본을 담지 못했던 곳은 두 가지뿐이다. (1) `report_doc.body` — R2 가 없어 문서 원문을 둘 곳이 없었다(마이그레이션 0004). (2) `note_comment.id` — 원본에 댓글 id 가 없어 `report_id*1000 + 순번` 으로 만든다(스키마 변경 없음, 댓글은 알림장당 999개까지). `growth_ref` 는 L·M·S·p3·p50·p97 만 담고 다른 백분위(p5~p95)·단위는 담지 않는다.
- **긴 본문**: D1 문장 한도(100KB)를 넘는 문자열 칸은 적재가 나눠 붙이므로(`07` §4) 앱은 신경 쓰지 않는다.
- **교사·다른 보호자 실명은 적재하지 않는다**(`author_role` 만). 알림장 본문 속 다른 아이 이름은 원문이라 그대로 두되 S1 로 취급한다.
- 검색(F4)은 1차에서 `LIKE` 로 충분하다(483행, 행 크기 작음, D1 `LIKE` 패턴 50바이트 제한 → 입력 길이 제한 40자). 한국어 부분 일치용 FTS5 trigram 은 M3 스파이크로 검증 후 도입 여부 결정(D-05).
- 날짜: 알림장 `date` 는 원 날짜, 시각은 KST 문자열(기존 `EXTRACTION.md` §4 와 동일).

## 3. 가족 기록 종류 (`log_type.schema_json`)

| code | 필드 (모두 목록 선택, 메모 제외) | 출처 |
|---|---|---|
| `meal` | announced(O/X), came(바로 옴/달래서 옴/안 옴), tantrum_min(0~120), aggression(없음/물건 던짐/사람 때림), amount(많이/조금/안 먹음), snack_before(없음/조금/많이), sick(O/X), phone(없음/카메라/영상/영상통화) | 저녁 식사 2주 기록표 + 화면 사용 논의 |
| `cry` | trigger(밴드/잠자리/식사/분리/기타), minutes, soothed_by(안아줌/주의 돌림/스스로/기타), place(집/외출) | 울음 기록 제안 |
| `skin_pick` | when(영상/차/잠자리/기타), mood(심심/피곤/속상/기타), hand_state(거스러미/건조/상처/정상), response | 손 뜯기 관찰 |
| `bandage_step` | step(0~5), result(성공/한 칸 내림/중단), helper | 상처 밴드 연습 사다리 |

경고 규칙(F2-5)은 코드에 하드코딩하지 않고 `log_type.schema_json.alerts` 로 둔다. 예: `{"field":"tantrum_min","op":">=","value":25,"guide":"guide/05#3-1"}`.

## 4. R2 객체

| 키 접두어 | 내용 | 등급 |
|---|---|---|
| `reports/{slug}/{sha256}.html` | 발달 보고서·행동 가이드 HTML | S1 |
| `docs/{path}.md` | guide·wiki 마크다운 | S1 |
| `s2/checkup/{date}.jpg` | 결과통보서 원본 사진 | S2 |

- 버킷은 **공개 접근 비활성**(public bucket·r2.dev 주소 끔). Functions 바인딩으로만 읽는다.
- 키에 해시를 넣어 덮어쓰기 대신 새 버전을 만들고, `report_doc` 가 현재 버전을 가리킨다(롤백 용이).
