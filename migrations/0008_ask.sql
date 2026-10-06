-- T-Q 물어보기 (docs/03 §ask, docs/11-ask.md). (0008).
-- 가족 질문 -> 집 PC 워커가 집어 답변 -> 앱에 게시. 질문·답은 개인 자료이므로 로그에 쓰지 않는다.
CREATE TABLE ask_question (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  asked_by    TEXT NOT NULL,            -- 기록자 이름(기존 기록자 체계, 1~12자)
  body        TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 1000),
  status      TEXT NOT NULL CHECK (status IN ('pending','claimed','answering','reviewing','done','failed')),
  red_flag    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,            -- ISO8601 UTC (고정 폭: 문자열 비교 = 시간 순서)
  claimed_at  TEXT,
  lease_until TEXT,                     -- 워커가 잡고 있는 기한. 지나면 다시 집을 수 있다
  attempts    INTEGER NOT NULL DEFAULT 0,
  fail_code   TEXT,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT
);
CREATE INDEX idx_ask_question_status ON ask_question(status, created_at);

CREATE TABLE ask_answer (
  question_id  INTEGER PRIMARY KEY REFERENCES ask_question(id),
  level        INTEGER NOT NULL CHECK (level BETWEEN 1 AND 10),
  answer_json  TEXT NOT NULL CHECK (length(answer_json) <= 61440),
  review_score REAL,
  model        TEXT,
  wait_ms      INTEGER,                 -- 질문 -> 워커가 집음
  work_ms      INTEGER,                 -- 집음 -> 답 업로드(워커 보고값)
  total_ms     INTEGER,                 -- 질문 -> 답 게시
  created_at   TEXT NOT NULL
);

CREATE TABLE ask_feedback (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id INTEGER NOT NULL REFERENCES ask_question(id),
  by          TEXT NOT NULL,
  helpful     INTEGER CHECK (helpful IN (0, 1)),
  note        TEXT CHECK (note IS NULL OR length(note) <= 500),
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_ask_feedback_question ON ask_feedback(question_id, id);

-- 워커 토큰 실패 기록(PIN 용 auth_attempt 와 별도 집계). 10분 20회 초과 시 15분 잠금(app_setting.ask_worker_locked_until).
CREATE TABLE worker_auth_fail (at TEXT NOT NULL);
CREATE INDEX idx_worker_auth_fail_at ON worker_auth_fail(at);
