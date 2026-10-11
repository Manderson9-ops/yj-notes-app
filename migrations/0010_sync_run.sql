-- T-S1 알림장 자동 업데이트 실행 기록 (0010). 집 PC 가 매일 저녁 8시(KST)에 시작·끝을 보고한다.
-- 본문·이름·키즈노트 응답은 담지 않는다(상태·단계·코드·건수·날짜뿐). 90일 지난 행은 기록할 때 지운다.
-- 다시 만들 수 있는 로그라 백업 복원 대상이 아니다(docs/03).
CREATE TABLE sync_run (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at    TEXT NOT NULL,              -- ISO8601 UTC (고정 폭)
  finished_at   TEXT,
  status        TEXT NOT NULL CHECK (status IN ('running','ok','no_new','failed')),
  stage         TEXT,                       -- fetch|merge|build|verify|media|downstream|commit|ingest|report
  code          TEXT,                       -- ^[a-z0-9_]{1,40}$
  new_reports   INTEGER,
  new_comments  INTEGER,
  last_note_date TEXT,                      -- YYYY-MM-DD
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_sync_run_started ON sync_run(started_at);
