-- 합성 fixture: 알림장 경계값 보충 (docs/04 §5). fixtures.sql 다음에 실행한다(2020-03 은 거기 있음).
-- 추가: 빈 본문, 아주 긴 본문(생성식), LIKE 특수문자(% _ \), 엽서(to_center) 방향, 댓글 0건. 댓글 3개 추가 -> 합계 40.
-- 모든 값은 가상이다.
INSERT INTO note_day (date, class_name, age_months, n_reports, n_images, n_comments, first_line) VALUES ('2020-04-01', '합성반', 2, 1, 0, 0, '');
INSERT INTO note_item (report_id, date, author_role, direction, weather, posted_at, body) VALUES (9000101, '2020-04-01', '교사', 'to_home', NULL, '2020-04-01 16:10', '');

INSERT INTO note_day (date, class_name, age_months, n_reports, n_images, n_comments, first_line) VALUES ('2020-04-02', '합성반', 2, 1, 0, 1, '블록을 쌓고 무너뜨리기를 반복했어요.');
INSERT INTO note_item (report_id, date, author_role, direction, weather, posted_at, body) VALUES (9000102, '2020-04-02', '교사', 'to_home', '맑음', '2020-04-02 16:10', replace(hex(zeroblob(600)), '00', '블록을 쌓고 무너뜨리기를 반복했어요. ' || char(10)));
INSERT INTO note_comment (id, report_id, who, posted_at, body) VALUES (38, 9000102, 'parent', '2020-04-02 17:00', '긴 글 잘 읽었어요.');

INSERT INTO note_day (date, class_name, age_months, n_reports, n_images, n_comments, first_line) VALUES ('2020-04-03', '합성반', 2, 1, 0, 2, '할인 100% 행사 놀이, a_b 표지판, 경로 C:\놀이');
INSERT INTO note_item (report_id, date, author_role, direction, weather, posted_at, body) VALUES (9000103, '2020-04-03', '교사', 'to_home', '흐림', '2020-04-03 16:10', '할인 100% 행사 놀이, a_b 표지판, 경로 C:\놀이' || char(10) || '특수문자 확인용 합성 문장이에요.');
INSERT INTO note_comment (id, report_id, who, posted_at, body) VALUES (39, 9000103, 'teacher', '2020-04-03 17:00', '100% 확인했어요.');
INSERT INTO note_comment (id, report_id, who, posted_at, body) VALUES (40, 9000103, 'parent', '2020-04-03 17:05', '표지판 놀이 좋아해요.');

INSERT INTO note_day (date, class_name, age_months, n_reports, n_images, n_comments, first_line) VALUES ('2020-04-04', '합성반', 2, 2, 0, 0, '가정에서 보낸 메모: 아침에 일찍 일어났어요.');
INSERT INTO note_item (report_id, date, author_role, direction, weather, posted_at, body) VALUES (9000104, '2020-04-04', '엄마', 'to_center', NULL, '2020-04-04 08:30', '가정에서 보낸 메모: 아침에 일찍 일어났어요.');
INSERT INTO note_item (report_id, date, author_role, direction, weather, posted_at, body) VALUES (9000105, '2020-04-04', '교사', 'to_home', '맑음', '2020-04-04 16:10', '메모 잘 받았어요. 오늘은 평소처럼 지냈어요.');
