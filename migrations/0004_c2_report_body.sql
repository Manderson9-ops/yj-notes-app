-- T-C2: 보고서 본문을 D1 에 둔다(R2 미사용 단계). docs/03 §2 report_doc 변경, docs/05 보고서 절.
-- body 가 NULL 이면 r2_key 로 R2(FILES 바인딩)에서 읽는다. 본문은 행당 2MB 미만이어야 한다(D1 행 한도).
ALTER TABLE report_doc ADD COLUMN body TEXT;
