-- T-Q3 물어보기 2차: 표(사람당 질문당 한 표)·다시 답변 이력 (docs/03 §ask, docs/11-ask.md). (0009).
-- 질문·답·의견은 개인 자료이므로 로그에 쓰지 않는다.
CREATE TABLE ask_vote (
  question_id INTEGER NOT NULL REFERENCES ask_question(id),
  by          TEXT NOT NULL,
  helpful     INTEGER NOT NULL CHECK (helpful IN (0, 1)),
  reason      TEXT CHECK (reason IS NULL OR (helpful = 0 AND length(reason) <= 200)),
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (question_id, by)
);

-- 기존 ask_feedback 의 도움 여부 -> ask_vote (같은 사람은 마지막 값). ask_feedback 은 메모 전용으로 남기고 helpful 열은 더 쓰지 않는다(지우지 않음).
INSERT INTO ask_vote (question_id, by, helpful, reason, updated_at)
SELECT f.question_id, f.by, f.helpful, NULL, f.created_at
FROM ask_feedback f
WHERE f.helpful IS NOT NULL
  AND f.id = (SELECT MAX(g.id) FROM ask_feedback g
              WHERE g.question_id = f.question_id AND g.by = f.by AND g.helpful IS NOT NULL);

-- 다시 답변: 이전 답을 버전으로 보관한다(버전 1부터, 최신 답은 ask_answer 에 있다).
CREATE TABLE ask_answer_history (
  question_id  INTEGER NOT NULL REFERENCES ask_question(id),
  version      INTEGER NOT NULL,
  level        INTEGER NOT NULL CHECK (level BETWEEN 1 AND 10),
  answer_json  TEXT NOT NULL CHECK (length(answer_json) <= 61440),
  review_score REAL,
  model        TEXT,
  total_ms     INTEGER,
  created_at   TEXT NOT NULL,
  PRIMARY KEY (question_id, version)
);

ALTER TABLE ask_question ADD COLUMN reask_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ask_question ADD COLUMN reask_reason TEXT CHECK (reask_reason IS NULL OR length(reask_reason) <= 300);
ALTER TABLE ask_question ADD COLUMN reask_by TEXT;
-- 마지막 다시 답변 요청 시각: 대기·소요 시간을 이 시각부터 센다.
ALTER TABLE ask_question ADD COLUMN reask_at TEXT;

CREATE INDEX idx_ask_vote_updated ON ask_vote(updated_at);
