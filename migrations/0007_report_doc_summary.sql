-- docs/03 §2 report_doc 와 같이 유지한다. (R1-10)
-- 목록 카드의 한 줄 설명(최대 200자). 적재가 계산해 채운다. NULL 이면 API 가 본문 앞부분에서 직접 만든다.
ALTER TABLE report_doc ADD COLUMN summary TEXT;
