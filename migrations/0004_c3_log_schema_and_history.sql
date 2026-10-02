-- T-C3 가족 기록 (docs/03 §3). 병합 때 번호 정리.
-- 1) log_type 질문 정의에 화면·요약용 항목을 더한다: 단위(unit), 칩 값(presets), 경고 문구(message_ko),
--    요약 설정(summary.highlight·crosstabs). 질문·선택지·경고 조건은 0002 와 같다.
-- 2) 기록 수정·삭제 이력(F2-3, docs/04 "기록 변조·삭제"): 바뀌기 전 모습을 남긴다.

UPDATE log_type SET schema_json = '{"fields":[{"key":"announced","label_ko":"미리 알림","type":"enum","options":["O","X"],"required":true},{"key":"came","label_ko":"식탁에 올 때","type":"enum","options":["바로 옴","달래서 옴","안 옴"],"required":true},{"key":"tantrum_min","label_ko":"떼쓴 시간","type":"int","min":0,"max":120,"unit":"분","presets":[0,5,10,15,20,25],"required":true},{"key":"aggression","label_ko":"공격 행동","type":"enum","options":["없음","물건 던짐","사람 때림"],"required":true},{"key":"amount","label_ko":"먹은 양","type":"enum","options":["많이","조금","안 먹음"],"required":true},{"key":"snack_before","label_ko":"식전 간식","type":"enum","options":["없음","조금","많이"],"required":true},{"key":"sick","label_ko":"아픔","type":"enum","options":["O","X"],"required":true},{"key":"phone","label_ko":"화면 사용","type":"enum","options":["없음","카메라","영상","영상통화"],"required":true}],"alerts":[{"field":"tantrum_min","op":">=","value":25,"guide":"guide/05#3-1","message_ko":"떼쓴 시간 25분 이상이 기록됐어요."},{"field":"aggression","op":"==","value":"사람 때림","guide":"guide/05#3-2","message_ko":"사람을 때린 기록이 있어요."}],"summary":{"highlight":["came","tantrum_min","amount"],"crosstabs":[{"rows":"snack_before","cols":"amount"}]}}' WHERE code = 'meal';

UPDATE log_type SET schema_json = '{"fields":[{"key":"trigger","label_ko":"계기","type":"enum","options":["밴드","잠자리","식사","분리","기타"],"required":true},{"key":"minutes","label_ko":"지속 시간","type":"int","min":0,"max":120,"unit":"분","presets":[0,5,10,15,20,30],"required":true},{"key":"soothed_by","label_ko":"달래기","type":"enum","options":["안아줌","주의 돌림","스스로","기타"],"required":true},{"key":"place","label_ko":"장소","type":"enum","options":["집","외출"],"required":true}],"alerts":[],"summary":{"highlight":["trigger","minutes"]}}' WHERE code = 'cry';

UPDATE log_type SET schema_json = '{"fields":[{"key":"when","label_ko":"언제","type":"enum","options":["영상","차","잠자리","기타"],"required":true},{"key":"mood","label_ko":"기분","type":"enum","options":["심심","피곤","속상","기타"],"required":true},{"key":"hand_state","label_ko":"손 상태","type":"enum","options":["거스러미","건조","상처","정상"],"required":true},{"key":"response","label_ko":"대응","type":"text","required":false}],"alerts":[],"summary":{"highlight":["when","hand_state"]}}' WHERE code = 'skin_pick';

UPDATE log_type SET schema_json = '{"fields":[{"key":"step","label_ko":"단계","type":"int","min":0,"max":5,"presets":[0,1,2,3,4,5],"required":true},{"key":"result","label_ko":"결과","type":"enum","options":["성공","한 칸 내림","중단"],"required":true},{"key":"helper","label_ko":"도운 사람","type":"text","required":false}],"alerts":[],"summary":{"highlight":["step","result"]}}' WHERE code = 'bandage_step';

CREATE TABLE family_log_history (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  log_id     TEXT NOT NULL,
  changed_at TEXT NOT NULL,            -- ISO8601 UTC
  change     TEXT NOT NULL CHECK (change IN ('update','delete')),
  before_json TEXT NOT NULL            -- 바뀌기 전 {type,occurredOn,recorder,payload,note}
);
CREATE INDEX idx_family_log_history_log ON family_log_history(log_id, id);
