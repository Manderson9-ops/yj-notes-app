-- T-Q5 물어보기 대화: 후속 질문·짧은 답·카드 갱신 턴 (docs/03 §ask_turn, docs/11-ask.md §대화). (0011).
-- 질문·답·대화 글은 개인 자료이므로 로그에 쓰지 않는다.
-- 한 턴 = 가족이 보낸 후속 질문(followup) 또는 👎 이유로 카드를 다시 만드는 요청(reask) 하나.
-- 짧은 답 단계(status·attempts·lease_until)와 카드 단계(card_*)는 회계를 따로 둔다.
CREATE TABLE ask_turn (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id      INTEGER NOT NULL REFERENCES ask_question(id),
  seq              INTEGER NOT NULL,                 -- 질문 안의 순번(1부터). 위급 턴도 센다
  kind             TEXT NOT NULL CHECK (kind IN ('followup','reask')),
  asked_by         TEXT NOT NULL,                    -- 기록자 이름(1~12자)
  body             TEXT NOT NULL DEFAULT '' CHECK (length(body) <= 1000), -- reask 의 자유 글은 비어 있을 수 있다
  reask_reason     TEXT CHECK (reask_reason IS NULL OR length(reask_reason) <= 300),
  red_flag         INTEGER NOT NULL DEFAULT 0,
  status           TEXT NOT NULL CHECK (status IN ('pending','claimed','answering','reviewing','done','failed')),
  reply_json       TEXT CHECK (reply_json IS NULL OR length(reply_json) <= 8192),
  draft_json       TEXT CHECK (draft_json IS NULL OR length(draft_json) <= 61440), -- T-Q4b 용(지금은 쓰지 않는다)
  draft_at         TEXT,                             -- T-Q4b 용
  review_score     REAL,
  card_status      TEXT NOT NULL DEFAULT 'none' CHECK (card_status IN ('none','pending','done','failed')),
  card_version     INTEGER,                          -- 이 턴이 만든 카드의 이력 번호(ask_answer_history.version 대조)
  card_attempts    INTEGER NOT NULL DEFAULT 0,
  card_lease_until TEXT,
  card_note        TEXT,                             -- 'limit' | 'redlock'
  card_fail_code   TEXT,
  card_reason      TEXT CHECK (card_reason IS NULL OR length(card_reason) <= 160),
  reply_model      TEXT,
  card_model       TEXT,
  created_at       TEXT NOT NULL,
  replied_at       TEXT,
  claimed_at       TEXT,
  lease_until      TEXT,
  retry_after      TEXT,                             -- T-Q4b 용(지금은 쓰지 않는다)
  attempts         INTEGER NOT NULL DEFAULT 0,
  auth_refunds     INTEGER NOT NULL DEFAULT 0,       -- T-Q4b 용
  fail_code        TEXT,
  wait_ms          INTEGER,
  draft_ms         INTEGER,                          -- T-Q4b 용
  work_ms          INTEGER,                          -- 짧은 답 단계만
  card_work_ms     INTEGER,
  total_ms         INTEGER,
  updated_at       TEXT NOT NULL,
  deleted_at       TEXT
);
CREATE INDEX idx_ask_turn_status ON ask_turn(status, created_at);
CREATE INDEX idx_ask_turn_card_status ON ask_turn(card_status, created_at);
CREATE UNIQUE INDEX idx_ask_turn_question_seq ON ask_turn(question_id, seq);

-- 카드 갱신 횟수(일반 후속의 cardUpdate 와 reask 턴 합쳐 질문당 ASK_REASK_MAX, 위급 갱신은 세지 않는다).
ALTER TABLE ask_question ADD COLUMN card_updates INTEGER NOT NULL DEFAULT 0;
-- 위급 잠금: 이 질문의 카드는 10단계로 굳는다(해제 경로 없음). 서버는 red_flag OR red_lock 으로 본다.
ALTER TABLE ask_question ADD COLUMN red_lock INTEGER NOT NULL DEFAULT 0;
-- 대화 중 위급 글이 와서 새 위급 질문으로 이어진 경우 원 질문 번호(본문 CHECK 1000자 때문에 본문에 붙이지 않는다).
ALTER TABLE ask_question ADD COLUMN origin_question_id INTEGER;

-- 기존 행 이행: 이미 다시 답변을 쓴 질문이 3회를 더 받지 않게, 위급 질문은 처음부터 잠근다.
UPDATE ask_question SET card_updates = reask_count, red_lock = red_flag;
