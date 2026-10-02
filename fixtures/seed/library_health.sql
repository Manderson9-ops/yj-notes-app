-- 합성 fixture: 자료실(F1)·검진·성장(F3) 화면용 (T-C2). 모든 값은 가상이며 날짜는 2020~2021년이다.
-- 0001·0002·0004 마이그레이션 적용 후 실행. 기존 fixtures.sql 과 키가 겹치지 않는다(slug lh-*, id 100번대, growth_id LH-*).
-- 기준표 값은 공개 기준표의 형태(L/M/S → p3·p50·p97)를 흉내 낸 합성 값이며 실제 기준표가 아니다.

INSERT OR REPLACE INTO app_setting (key, value) VALUES ('child_birth_date', '2020-01-15');
INSERT OR REPLACE INTO app_setting (key, value) VALUES ('child_sex', 'F');

INSERT INTO report_doc (slug, title, kind, r2_key, generated_at, source_commit, verify_ok, sha256, body) VALUES ('lh-report-summary', '합성 발달 보고서', 'html', 'reports/lh-report-summary/7777777777777777777777777777777777777777777777777777777777777777.html', '2020-09-01T00:00:00Z', 'fixture0000', 1, '7777777777777777777777777777777777777777777777777777777777777777', '<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>합성 발달 보고서</title>
<style>body{font-family:sans-serif;margin:16px;line-height:1.6}h1{font-size:1.3em}.box{border:1px solid #888;padding:8px;border-radius:8px}</style>
</head><body>
<h1>합성 발달 보고서</h1>
<p class="box" id="out">스크립트 실행 전</p>
<p>이 문서는 sandbox iframe 안에서만 열리는 합성 HTML 이다.</p>
<script>document.getElementById("out").textContent = "스크립트 실행됨";</script>
</body></html>');
INSERT INTO report_doc (slug, title, kind, r2_key, generated_at, source_commit, verify_ok, sha256, body) VALUES ('lh-guide-routine', '합성 생활 가이드', 'markdown', 'reports/lh-guide-routine/6666666666666666666666666666666666666666666666666666666666666666.md', '2020-09-02T00:00:00Z', 'fixture0000', 1, '6666666666666666666666666666666666666666666666666666666666666666', '# 합성 생활 가이드

이 문서는 화면 시안용 합성 글이다. 실제 가정의 자료와 관계가 없다.

## 하루 흐름 살피기

하루를 아침, 낮, 저녁으로 나누어 적어 두면 한눈에 볼 수 있다. 각 구간에서 눈에 띈 점을 한두 줄로 남긴다.
아래는 기록 항목 예시다.

- 일어난 시각과 잠든 시각
- 식사 때 앉아 있던 시간
- 바깥 놀이를 한 시간

## 기록 표 예시

| 항목 | 기록 방법 | 예시 |
| --- | --- | --- |
| 식사 | 먹은 양을 칩으로 고른다 | 조금 |
| 낮잠 | 시작과 끝 시각을 적는다 | 13시~14시 |
| 놀이 | 한 줄 메모를 남긴다 | 블록 쌓기 |

## 도움을 요청할 때

> 기록은 판단을 내리기 위한 것이 아니라 함께 이야기할 근거를 모으기 위한 것이다.

상담을 받을 때는 기록한 날짜와 횟수를 그대로 보여 주면 된다. 자세한 내용은 [안내 페이지](https://example.org/guide) 에서 볼 수 있다.

<script>alert(''이 줄은 글자 그대로 보여야 한다'')</script>

## 용어 메모

1. 백분위: 같은 나이 아이들을 키 순서로 세웠을 때의 위치를 나타내는 숫자.
2. 개월 수: 생일 기준으로 센 만 개월.
3. 판독 불확실: 결과지 글씨를 읽기 어려워 값이 다를 수 있다는 표시.

```
예시 코드 블록: 2020-03-02 / 기록 3건
```');
INSERT INTO report_doc (slug, title, kind, r2_key, generated_at, source_commit, verify_ok, sha256, body) VALUES ('lh-wiki-terms', '합성 용어 모음', 'markdown', 'reports/lh-wiki-terms/3333333333333333333333333333333333333333333333333333333333333333.md', '2020-09-03T00:00:00Z', 'fixture0000', 0, '3333333333333333333333333333333333333333333333333333333333333333', '# 합성 용어 모음

화면에서 쓰는 낱말을 짧게 풀어 둔 합성 위키 문서다.

## 성장 곡선

1번째 문단. 긴 글을 읽을 때는 한 줄이 너무 길지 않아야 눈이 편하다. 큰 글씨로 바꿔도 줄바꿈이 자연스러워야 하고, 목차로 원하는 곳까지 바로 이동할 수 있어야 한다. 이 문장들은 화면 확인용으로 새로 쓴 합성 글이다.
2번째 문단. 긴 글을 읽을 때는 한 줄이 너무 길지 않아야 눈이 편하다. 큰 글씨로 바꿔도 줄바꿈이 자연스러워야 하고, 목차로 원하는 곳까지 바로 이동할 수 있어야 한다. 이 문장들은 화면 확인용으로 새로 쓴 합성 글이다.

## 검진 결과지

3번째 문단. 긴 글을 읽을 때는 한 줄이 너무 길지 않아야 눈이 편하다. 큰 글씨로 바꿔도 줄바꿈이 자연스러워야 하고, 목차로 원하는 곳까지 바로 이동할 수 있어야 한다. 이 문장들은 화면 확인용으로 새로 쓴 합성 글이다.
4번째 문단. 긴 글을 읽을 때는 한 줄이 너무 길지 않아야 눈이 편하다. 큰 글씨로 바꿔도 줄바꿈이 자연스러워야 하고, 목차로 원하는 곳까지 바로 이동할 수 있어야 한다. 이 문장들은 화면 확인용으로 새로 쓴 합성 글이다.

## 이정표

5번째 문단. 긴 글을 읽을 때는 한 줄이 너무 길지 않아야 눈이 편하다. 큰 글씨로 바꿔도 줄바꿈이 자연스러워야 하고, 목차로 원하는 곳까지 바로 이동할 수 있어야 한다. 이 문장들은 화면 확인용으로 새로 쓴 합성 글이다.

- 관찰한 날짜
- 관찰한 장면
- 출처

## 알림장

6번째 문단. 긴 글을 읽을 때는 한 줄이 너무 길지 않아야 눈이 편하다. 큰 글씨로 바꿔도 줄바꿈이 자연스러워야 하고, 목차로 원하는 곳까지 바로 이동할 수 있어야 한다. 이 문장들은 화면 확인용으로 새로 쓴 합성 글이다.
7번째 문단. 긴 글을 읽을 때는 한 줄이 너무 길지 않아야 눈이 편하다. 큰 글씨로 바꿔도 줄바꿈이 자연스러워야 하고, 목차로 원하는 곳까지 바로 이동할 수 있어야 한다. 이 문장들은 화면 확인용으로 새로 쓴 합성 글이다.

## 마무리

8번째 문단. 긴 글을 읽을 때는 한 줄이 너무 길지 않아야 눈이 편하다. 큰 글씨로 바꿔도 줄바꿈이 자연스러워야 하고, 목차로 원하는 곳까지 바로 이동할 수 있어야 한다. 이 문장들은 화면 확인용으로 새로 쓴 합성 글이다.');

INSERT INTO checkup (id, round_label, exam_date, age_months, overall, remarks, dev_result, source_image_key) VALUES (101, '합성 1차 (4~6개월용)', '2020-05-20', 4, '합성 종합 문구 예시 1', '합성 참고 문구 예시 1', '합성 발달 문구 예시 1', NULL);
INSERT INTO checkup (id, round_label, exam_date, age_months, overall, remarks, dev_result, source_image_key) VALUES (102, '합성 5차 (18~24개월용)', '2021-07-20', 18, '합성 종합 문구 예시 2', NULL, '합성 발달 문구 예시 2', NULL);
INSERT INTO measurement (id, checkup_id, measured_on, measure, value, sheet_percentile, read_status, condition_note) VALUES (101, 101, '2020-05-20', 'height_cm', 62.5, 55, 'CONFIRMED', NULL);
INSERT INTO measurement (id, checkup_id, measured_on, measure, value, sheet_percentile, read_status, condition_note) VALUES (102, 101, '2020-05-20', 'weight_kg', 6.4, 40, 'CONFIRMED', '옷 입고 측정');
INSERT INTO measurement (id, checkup_id, measured_on, measure, value, sheet_percentile, read_status, condition_note) VALUES (103, 101, '2020-05-20', 'head_circ_cm', 40.8, NULL, 'UNCERTAIN', NULL);
INSERT INTO measurement (id, checkup_id, measured_on, measure, value, sheet_percentile, read_status, condition_note) VALUES (104, 101, '2020-05-20', 'bmi', 16.4, 60, 'CONFIRMED', NULL);
INSERT INTO measurement (id, checkup_id, measured_on, measure, value, sheet_percentile, read_status, condition_note) VALUES (105, 102, '2021-07-20', 'height_cm', 81, 45, 'CONFIRMED', NULL);
INSERT INTO measurement (id, checkup_id, measured_on, measure, value, sheet_percentile, read_status, condition_note) VALUES (106, 102, '2021-07-20', 'weight_kg', 10.2, 50, 'CONFIRMED', '옷 입고 측정');
INSERT INTO measurement (id, checkup_id, measured_on, measure, value, sheet_percentile, read_status, condition_note) VALUES (107, 102, '2021-07-20', 'head_circ_cm', 46, 35, 'CONFIRMED', NULL);
INSERT INTO measurement (id, checkup_id, measured_on, measure, value, sheet_percentile, read_status, condition_note) VALUES (108, 102, '2021-07-20', 'bmi', 15.5, 42, 'CONFIRMED', NULL);
INSERT INTO measurement (id, checkup_id, measured_on, measure, value, sheet_percentile, read_status, condition_note) VALUES (109, NULL, '2020-09-12', 'height_cm', 68.4, NULL, 'CONFIRMED', '집에서 측정');
INSERT INTO measurement (id, checkup_id, measured_on, measure, value, sheet_percentile, read_status, condition_note) VALUES (110, NULL, '2020-09-12', 'weight_kg', 7.9, NULL, 'CONFIRMED', '집에서 측정, 기저귀 착용');
INSERT INTO measurement (id, checkup_id, measured_on, measure, value, sheet_percentile, read_status, condition_note) VALUES (111, NULL, '2021-01-20', 'height_cm', 74.6, NULL, 'CONFIRMED', '집에서 측정');
INSERT INTO measurement (id, checkup_id, measured_on, measure, value, sheet_percentile, read_status, condition_note) VALUES (112, NULL, '2021-01-20', 'weight_kg', 9, NULL, 'CONFIRMED', '집에서 측정');

INSERT INTO growth_ref (growth_id, source_id, measure, sex, age_month, l, m, s, p3, p50, p97) VALUES ('LH-height_cm-F-0', 'SYNTH-LMS', 'height_cm', 'F', 0, 1, 49.1, 0.0379, 45.6, 49.1, 52.6);
INSERT INTO growth_ref (growth_id, source_id, measure, sex, age_month, l, m, s, p3, p50, p97) VALUES ('LH-height_cm-F-3', 'SYNTH-LMS', 'height_cm', 'F', 3, 1, 59.8, 0.0364, 55.7, 59.8, 63.9);
INSERT INTO growth_ref (growth_id, source_id, measure, sex, age_month, l, m, s, p3, p50, p97) VALUES ('LH-height_cm-F-6', 'SYNTH-LMS', 'height_cm', 'F', 6, 1, 65.7, 0.0368, 61.2, 65.7, 70.2);
INSERT INTO growth_ref (growth_id, source_id, measure, sex, age_month, l, m, s, p3, p50, p97) VALUES ('LH-height_cm-F-9', 'SYNTH-LMS', 'height_cm', 'F', 9, 1, 70.1, 0.0372, 65.2, 70.1, 75);
INSERT INTO growth_ref (growth_id, source_id, measure, sex, age_month, l, m, s, p3, p50, p97) VALUES ('LH-height_cm-F-12', 'SYNTH-LMS', 'height_cm', 'F', 12, 1, 74, 0.0378, 68.7, 74, 79.3);
INSERT INTO growth_ref (growth_id, source_id, measure, sex, age_month, l, m, s, p3, p50, p97) VALUES ('LH-height_cm-F-15', 'SYNTH-LMS', 'height_cm', 'F', 15, 1, 77.5, 0.0381, 71.9, 77.5, 83.1);
INSERT INTO growth_ref (growth_id, source_id, measure, sex, age_month, l, m, s, p3, p50, p97) VALUES ('LH-height_cm-F-18', 'SYNTH-LMS', 'height_cm', 'F', 18, 1, 80.7, 0.0386, 74.8, 80.7, 86.6);
INSERT INTO growth_ref (growth_id, source_id, measure, sex, age_month, l, m, s, p3, p50, p97) VALUES ('LH-height_cm-F-21', 'SYNTH-LMS', 'height_cm', 'F', 21, 1, 83.7, 0.0391, 77.5, 83.7, 89.9);
INSERT INTO growth_ref (growth_id, source_id, measure, sex, age_month, l, m, s, p3, p50, p97) VALUES ('LH-height_cm-F-24', 'SYNTH-LMS', 'height_cm', 'F', 24, 1, 86.4, 0.0395, 80, 86.4, 92.8);
INSERT INTO growth_ref (growth_id, source_id, measure, sex, age_month, l, m, s, p3, p50, p97) VALUES ('LH-weight_kg-F-0', 'SYNTH-LMS', 'weight_kg', 'F', 0, -0.38, 3.2, 0.142, 2.5, 3.2, 4.2);
INSERT INTO growth_ref (growth_id, source_id, measure, sex, age_month, l, m, s, p3, p50, p97) VALUES ('LH-weight_kg-F-3', 'SYNTH-LMS', 'weight_kg', 'F', 3, -0.2, 5.8, 0.126, 4.6, 5.8, 7.4);
INSERT INTO growth_ref (growth_id, source_id, measure, sex, age_month, l, m, s, p3, p50, p97) VALUES ('LH-weight_kg-F-6', 'SYNTH-LMS', 'weight_kg', 'F', 6, -0.18, 7.3, 0.125, 5.8, 7.3, 9.3);
INSERT INTO growth_ref (growth_id, source_id, measure, sex, age_month, l, m, s, p3, p50, p97) VALUES ('LH-weight_kg-F-9', 'SYNTH-LMS', 'weight_kg', 'F', 9, -0.2, 8.2, 0.126, 6.5, 8.2, 10.5);
INSERT INTO growth_ref (growth_id, source_id, measure, sex, age_month, l, m, s, p3, p50, p97) VALUES ('LH-weight_kg-F-12', 'SYNTH-LMS', 'weight_kg', 'F', 12, -0.24, 8.9, 0.127, 7.1, 8.9, 11.4);
INSERT INTO growth_ref (growth_id, source_id, measure, sex, age_month, l, m, s, p3, p50, p97) VALUES ('LH-weight_kg-F-15', 'SYNTH-LMS', 'weight_kg', 'F', 15, -0.27, 9.6, 0.128, 7.6, 9.6, 12.3);
INSERT INTO growth_ref (growth_id, source_id, measure, sex, age_month, l, m, s, p3, p50, p97) VALUES ('LH-weight_kg-F-18', 'SYNTH-LMS', 'weight_kg', 'F', 18, -0.3, 10.2, 0.129, 8.1, 10.2, 13.1);
INSERT INTO growth_ref (growth_id, source_id, measure, sex, age_month, l, m, s, p3, p50, p97) VALUES ('LH-weight_kg-F-21', 'SYNTH-LMS', 'weight_kg', 'F', 21, -0.33, 10.9, 0.13, 8.6, 10.9, 14.1);
INSERT INTO growth_ref (growth_id, source_id, measure, sex, age_month, l, m, s, p3, p50, p97) VALUES ('LH-weight_kg-F-24', 'SYNTH-LMS', 'weight_kg', 'F', 24, -0.35, 11.5, 0.131, 9.1, 11.5, 14.9);
INSERT INTO growth_ref (growth_id, source_id, measure, sex, age_month, l, m, s, p3, p50, p97) VALUES ('LH-head_circ_cm-F-0', 'SYNTH-LMS', 'head_circ_cm', 'F', 0, 1, 33.9, 0.0305, 32, 33.9, 35.8);
INSERT INTO growth_ref (growth_id, source_id, measure, sex, age_month, l, m, s, p3, p50, p97) VALUES ('LH-head_circ_cm-F-3', 'SYNTH-LMS', 'head_circ_cm', 'F', 3, 1, 40.2, 0.0285, 38, 40.2, 42.4);
INSERT INTO growth_ref (growth_id, source_id, measure, sex, age_month, l, m, s, p3, p50, p97) VALUES ('LH-head_circ_cm-F-6', 'SYNTH-LMS', 'head_circ_cm', 'F', 6, 1, 42.2, 0.0283, 40, 42.2, 44.4);
INSERT INTO growth_ref (growth_id, source_id, measure, sex, age_month, l, m, s, p3, p50, p97) VALUES ('LH-head_circ_cm-F-9', 'SYNTH-LMS', 'head_circ_cm', 'F', 9, 1, 43.6, 0.0283, 41.3, 43.6, 45.9);
INSERT INTO growth_ref (growth_id, source_id, measure, sex, age_month, l, m, s, p3, p50, p97) VALUES ('LH-head_circ_cm-F-12', 'SYNTH-LMS', 'head_circ_cm', 'F', 12, 1, 44.5, 0.0284, 42.1, 44.5, 46.9);
INSERT INTO growth_ref (growth_id, source_id, measure, sex, age_month, l, m, s, p3, p50, p97) VALUES ('LH-head_circ_cm-F-15', 'SYNTH-LMS', 'head_circ_cm', 'F', 15, 1, 45.2, 0.0285, 42.8, 45.2, 47.6);
INSERT INTO growth_ref (growth_id, source_id, measure, sex, age_month, l, m, s, p3, p50, p97) VALUES ('LH-head_circ_cm-F-18', 'SYNTH-LMS', 'head_circ_cm', 'F', 18, 1, 45.9, 0.0286, 43.4, 45.9, 48.4);
INSERT INTO growth_ref (growth_id, source_id, measure, sex, age_month, l, m, s, p3, p50, p97) VALUES ('LH-head_circ_cm-F-21', 'SYNTH-LMS', 'head_circ_cm', 'F', 21, 1, 46.4, 0.0287, 43.9, 46.4, 48.9);
INSERT INTO growth_ref (growth_id, source_id, measure, sex, age_month, l, m, s, p3, p50, p97) VALUES ('LH-head_circ_cm-F-24', 'SYNTH-LMS', 'head_circ_cm', 'F', 24, 1, 46.8, 0.0288, 44.3, 46.8, 49.3);
INSERT INTO growth_ref (growth_id, source_id, measure, sex, age_month, l, m, s, p3, p50, p97) VALUES ('LH-bmi-F-0', 'SYNTH-LMS', 'bmi', 'F', 0, -0.5, 13.3, 0.092, 11.3, 13.3, 15.9);
INSERT INTO growth_ref (growth_id, source_id, measure, sex, age_month, l, m, s, p3, p50, p97) VALUES ('LH-bmi-F-3', 'SYNTH-LMS', 'bmi', 'F', 3, -0.5, 16, 0.085, 13.7, 16, 18.9);
INSERT INTO growth_ref (growth_id, source_id, measure, sex, age_month, l, m, s, p3, p50, p97) VALUES ('LH-bmi-F-6', 'SYNTH-LMS', 'bmi', 'F', 6, -0.5, 16.1, 0.082, 13.9, 16.1, 18.9);
INSERT INTO growth_ref (growth_id, source_id, measure, sex, age_month, l, m, s, p3, p50, p97) VALUES ('LH-bmi-F-9', 'SYNTH-LMS', 'bmi', 'F', 9, -0.5, 15.8, 0.081, 13.6, 15.8, 18.5);
INSERT INTO growth_ref (growth_id, source_id, measure, sex, age_month, l, m, s, p3, p50, p97) VALUES ('LH-bmi-F-12', 'SYNTH-LMS', 'bmi', 'F', 12, -0.5, 15.6, 0.08, 13.5, 15.6, 18.2);
INSERT INTO growth_ref (growth_id, source_id, measure, sex, age_month, l, m, s, p3, p50, p97) VALUES ('LH-bmi-F-15', 'SYNTH-LMS', 'bmi', 'F', 15, -0.5, 15.3, 0.079, 13.3, 15.3, 17.9);
INSERT INTO growth_ref (growth_id, source_id, measure, sex, age_month, l, m, s, p3, p50, p97) VALUES ('LH-bmi-F-18', 'SYNTH-LMS', 'bmi', 'F', 18, -0.5, 15.2, 0.079, 13.2, 15.2, 17.7);
INSERT INTO growth_ref (growth_id, source_id, measure, sex, age_month, l, m, s, p3, p50, p97) VALUES ('LH-bmi-F-21', 'SYNTH-LMS', 'bmi', 'F', 21, -0.5, 15.1, 0.079, 13.1, 15.1, 17.6);
INSERT INTO growth_ref (growth_id, source_id, measure, sex, age_month, l, m, s, p3, p50, p97) VALUES ('LH-bmi-F-24', 'SYNTH-LMS', 'bmi', 'F', 24, -0.5, 15, 0.079, 13, 15, 17.5);

INSERT INTO milestone (evidence_id, domain_ko, age_month, milestone_ko, source_id) VALUES ('LH-01', '언어', 8, '합성 이정표 1: 가상의 관찰 항목', 'FIXTURE');
INSERT INTO milestone (evidence_id, domain_ko, age_month, milestone_ko, source_id) VALUES ('LH-02', '사회', 10, '합성 이정표 2: 가상의 관찰 항목', 'FIXTURE');
INSERT INTO milestone (evidence_id, domain_ko, age_month, milestone_ko, source_id) VALUES ('LH-03', '인지', 12, '합성 이정표 3: 가상의 관찰 항목', 'FIXTURE');
INSERT INTO milestone (evidence_id, domain_ko, age_month, milestone_ko, source_id) VALUES ('LH-04', '정서', 14, '합성 이정표 4: 가상의 관찰 항목', 'FIXTURE');
INSERT INTO milestone (evidence_id, domain_ko, age_month, milestone_ko, source_id) VALUES ('LH-05', '운동', 16, '합성 이정표 5: 가상의 관찰 항목', 'FIXTURE');
INSERT INTO milestone (evidence_id, domain_ko, age_month, milestone_ko, source_id) VALUES ('LH-06', '언어', 18, '합성 이정표 6: 가상의 관찰 항목', 'FIXTURE');
INSERT INTO milestone (evidence_id, domain_ko, age_month, milestone_ko, source_id) VALUES ('LH-07', '사회', 20, '합성 이정표 7: 가상의 관찰 항목', 'FIXTURE');
INSERT INTO milestone (evidence_id, domain_ko, age_month, milestone_ko, source_id) VALUES ('LH-08', '인지', 22, '합성 이정표 8: 가상의 관찰 항목', 'FIXTURE');
INSERT INTO milestone (evidence_id, domain_ko, age_month, milestone_ko, source_id) VALUES ('LH-09', '정서', 24, '합성 이정표 9: 가상의 관찰 항목', 'FIXTURE');
INSERT INTO milestone (evidence_id, domain_ko, age_month, milestone_ko, source_id) VALUES ('LH-10', '운동', 26, '합성 이정표 10: 가상의 관찰 항목', 'FIXTURE');

