# 07. 키즈노트 동기화·적재 파이프라인

## 1. 원칙
- 키즈노트 **세션 쿠키를 저장하거나 클라우드로 보내지 않는다.** 관리자 PC 의 로그인된 브라우저 안에서 API 를 호출해 내려받는다.
- 기존 비공개 파이프라인(`$DATA_DIR/_source/build_md.py` 등)이 **정본 생성기**다. 이 저장소는 그 결과를 검증·적재만 한다(ADR-0005).
- 한 단계라도 실패하면 **다음 단계로 가지 않는다**(부분 적재 금지).

## 2. 전체 흐름

```
[1 수집]  브라우저(키즈노트 로그인) → /api/v1_2/children/{id}/reports 전량 + 댓글(v1)
            → $DATA_DIR/_source/raw/YYYY-MM-DD.json   (가정 PC, 비공개)
[2 대조]  기존 `$DATA_DIR/_source/kidsnote_*_reports.json` 과 id 단위 비교
            기존 건 변경/삭제 ≥1 → 중단·보고 (F5-2)   신규만 뒤에 추가
[3 생성]  python _source/build_md.py → alrimjang/
          python _source/download_media.py (선택, R2 미적재)
[4 하류]  tracking → guide → wiki → report 재빌드 (기존 스크립트)
[5 검증]  기존 verify_* 전부 + 독립 재읽기(원본 JSON ↔ .md 줄 단위)
[6 적재]  yj-notes-app/tools/ingest: export → verify → upload
[7 확인]  /api/health 의 lastIngestAt, /api/overview 건수 = 원본 건수
```

## 3. 실행 방식 (단계별 자동화)

| 단계 | 방식 | 상태 |
|---|---|---|
| v1 (M4) | 관리자가 Aside 에 "알림장 업데이트" 요청 → 1~6 수행(2026-09-28 수동 수행 절차를 그대로 스크립트화) | 1차 목표 |
| v2 (M6+) | Aside 주간 루틴(일요일 21시): 브라우저 세션으로 1~6 → 결과 알림. 키즈노트 로그아웃 상태면 알림만 보내고 중단 | 결정 D-06 후 |
| 기각 | 클라우드 크론이 키즈노트에 직접 로그인 | 비밀번호·쿠키를 클라우드에 둬야 함, 약관·차단 위험 |

## 4. `tools/ingest` CLI 계약

```
python -m tools.ingest export  --data-dir $DATA_DIR --out .ingest/   # D1 용 SQL·R2 업로드 목록 생성
python -m tools.ingest verify  --data-dir $DATA_DIR --out .ingest/   # 건수·인용·해시 대조
python -m tools.ingest upload  --out .ingest/ --env production         # wrangler d1 execute / r2 object put
python -m tools.ingest status  --env production                        # 원격 건수 vs 로컬 건수
```

- `.ingest/` 는 `.gitignore` 대상(S1 포함).
- export 는 **결정적**이어야 한다: 같은 입력 → 바이트 단위 같은 출력(정렬·고정 소수점·LF).
- upload 는 트랜잭션 단위: 새 `ingest_run(status='running')` → 테이블별 `DELETE`+`INSERT`(알림장·관측·근거·문서) → 건수 재확인 → `status='ok'`. 실패 시 `failed` 로 남기고 D1 Time Travel 로 복구(`09` R-02).
- **가족 기록(`family_log`)은 적재 대상이 아니다.** 앱이 정본이며 적재가 절대 지우지 않는다(테이블 화이트리스트로 강제).
- 검진(S2)은 `records/영유아검진/*.xlsx` 와 판독기록을 읽어 `checkup`·`measurement` 로, 원본 사진은 R2 `s2/` 로.

### verify 검사 목록
| ID | 검사 |
|---|---|
| I1 | 알림장 일수·건수·댓글 수 = 원본 JSON |
| I2 | 모든 본문·댓글 줄이 export 결과에 존재(기존 §5 검증과 같은 강도) |
| I3 | 관측 스니펫이 해당 날짜 본문에 존재(tracking T3 과 동일) |
| I4 | 보고서 HTML 의 sha256 = 기존 verify 통과 시점 파일 |
| I5 | 교사·보호자 실명이 export 결과 `author_role` 에 없음 |
| I6 | export 결과에 S2 가 `s2/` 접두어 밖으로 나가지 않음 |
| I7 | 원격 적재 후 건수 = 로컬 건수 |

## 5. 실패 시 메시지 예
- `[2 대조] 기존 알림장 1건이 수정됨 (report 1000000001, 2020-03-02 본문 3번째 줄). 적재 중단. 차이: …` → 관리자가 확인 후 `--accept-upstream-edit 1000000001` 로 재실행.
