-- docs/03 §2 report_doc 와 같이 유지한다. 변경 시 문서를 먼저 고친다.
-- R2 는 아직 쓰지 않으므로(M4 이후) 문서 원문(guide·wiki·tracking·report)은 D1 body 칸에 둔다.
-- body 가 있으면 r2_key 는 빈 문자열('')로 둔다. 나중에 R2 로 옮기면 body 를 NULL 로 하고 r2_key 를 채운다.
ALTER TABLE report_doc ADD COLUMN body TEXT;
