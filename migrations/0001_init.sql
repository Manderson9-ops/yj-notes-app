-- docs/03 §2 와 동일. 변경 시 문서를 먼저 고친다.
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

-- 보고서 메타 (본문은 R2)
CREATE TABLE report_doc (
  slug TEXT PRIMARY KEY, title TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('html','markdown')),
  r2_key TEXT NOT NULL, generated_at TEXT NOT NULL, source_commit TEXT NOT NULL,
  verify_ok INTEGER NOT NULL, sha256 TEXT NOT NULL
);

-- 보안
CREATE TABLE auth_attempt (ip_hash TEXT NOT NULL, at TEXT NOT NULL, ok INTEGER NOT NULL);
CREATE INDEX idx_auth_attempt ON auth_attempt(ip_hash, at);
CREATE TABLE app_setting (key TEXT PRIMARY KEY, value TEXT NOT NULL);  -- session_epoch 등
