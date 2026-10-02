# fixtures — 합성 테스트 자료

이 폴더는 **합성(가짜) 자료만** 둔다. 규칙의 원문은 [`docs/04-security-privacy.md`](../docs/04-security-privacy.md) §5 이다.
이 저장소는 공개이므로 실제 아이 자료는 어떤 형태로도 넣지 않는다.

## 규칙

| 대상 | 쓰는 값 |
|---|---|
| 아이 이름 | `테스트아이` |
| 생일 | `2020-01-15` |
| 교사 | `교사A` |
| 친구 | `친구A`, `친구B` |

- 문장은 **새로 쓴다.** 실제 알림장·댓글·보고서 문장을 바꿔 쓰거나 요약해서 옮기지 않는다.
- 실제 이름·실제 날짜와 결합된 기록·검진 값·키즈노트 응답·스크린샷을 넣지 않는다.
- 날짜는 합성 생일 `2020-01-15` 기준으로 만든 가상 날짜만 쓴다.
- 이미지·PDF·엑셀 같은 바이너리는 넣지 않는다(`tools/guard` 가 막는다).
- 의심스러우면 넣지 말고 설계 담당에게 묻는다. 이미 넣었다면 [`SECURITY.md`](../SECURITY.md) 절차로 위치만 알린다.

## 계획된 구성 (`docs/08-quality.md` §3, 작업 카드 T-20)

- 알림장 30일, 댓글 40개
- 이정표 10개, 검진 1건
- 가족 기록 각 종류 5건
- 경계값: 하루 2건 알림장, 댓글 0건, 빈 본문, 이모지, 아주 긴 본문(2MB 미만), UNCERTAIN 계측

## `data_dir/` (T-B1: ingest 용 합성 DATA_DIR)

실제 `DATA_DIR` 과 같은 구조의 **합성** 폴더다. `tools/ingest` 테스트가 export → verify → 적용을 돌린다.

- 알림장 30일(32건, 하루 2건 2일), 댓글 40개(0개인 알림장 다수), 빈 본문·이모지·CRLF·작은따옴표·아주 긴 본문(약 60KB, D1 문장 한도 초과 경로), 이정표 10개, 관측 11건, 성장 기준 12행, 검진 1건(UNCERTAIN 계측 포함), 문서 3개.
- 실제 폴더 이름(`alrimjang`·`records`·`_source`)은 가드(G1)가 저장소 어디서나 막으므로 다른 이름(`notes`·`checkups`·`source`)을 쓰고 `ingest.config.json` 이 가리킨다. xlsx 는 바이너리라 둘 수 없어 같은 열의 csv 를 쓴다(xlsx 읽기는 테스트가 코드로 만들어 검증한다).
- 파일은 손으로 고치지 않는다: `python -m tools.ingest.tests.gen_fixture` 로 다시 만든다(테스트가 저장된 파일과 바이트 단위로 비교). 일자 md 는 실제 빌더 형식을 따르되 원본 URL 줄은 뾀다(가드 G3).

파일: `seed/fixtures.sql`(알림장 30일·댓글 37개 등) + `seed/notes-edge.sql`(알림장 경계값 보충: 빈 본문, 아주 긴 본문(생성식), `% _ \` 특수문자, 가정 메모 방향, 댓글 3개 → 합계 40개). 두 파일을 순서대로 실행한다(`server/routes/notes.test.ts` 가 함께 쓴다). 500일 성능 시험용 자료는 파일이 아니라 그 테스트 안에서 생성한다. mock API(`dev:mock`) 는 별도로 합성 62일을 코드로 만든다(`vite-plugins/mock/notesData.ts`).

## 자료실·검진·성장 (T-C2)

`seed/library_health.sql`: 문서 3개(마크다운 2·HTML 1, slug `lh-*`), 검진 2건(`UNCERTAIN` 포함), 측정 12개, 여아 기준표(합성 LMS → p3·p50·97), 이정표 10개, `app_setting` 생일·성별.
`0004_report_doc_body` 마이그레이션 적용 후 실행(`wrangler d1 execute DB --local --file fixtures/seed/library_health.sql`). 시드 값은 새로 쓴 가상 값이고 기준표는 실제 기준표가 아니다.
