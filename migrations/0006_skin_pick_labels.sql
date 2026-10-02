-- T-E1 판정 어휘 정리(P1). skin_pick 의 「손 상태」 선택지 중 화면에 보이는 말 「정상」 을 「이상 없음」 으로 바꾼다.
-- 저장 값(payload.hand_state 의 "정상")과 options 는 그대로 둔다: 이미 쌓인 기록이 그대로 유효하고, 서버 검증도 같다.
-- 바뀌는 것은 enum 필드의 labels(값 -> 화면에 보일 말)뿐이다. 0005 정의에 labels 만 더한다.

UPDATE log_type SET schema_json = '{"fields":[{"key":"when","label_ko":"언제","type":"enum","options":["영상","차","잠자리","기타"],"required":true},{"key":"mood","label_ko":"기분","type":"enum","options":["심심","피곤","속상","기타"],"required":true},{"key":"hand_state","label_ko":"손 상태","type":"enum","options":["거스러미","건조","상처","정상"],"labels":{"정상":"이상 없음"},"required":true},{"key":"response","label_ko":"대응","type":"text","required":false}],"alerts":[],"summary":{"highlight":["when","hand_state"]}}' WHERE code = 'skin_pick';