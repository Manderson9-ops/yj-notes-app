# tools/guard — 유출 방지 가드

공개 저장소에 실제 자료(알림장 문장, 실명, 연락처, 비밀값)가 들어가지 않게 막는 검사 도구.
규칙 원문: [`docs/04-security-privacy.md`](../../docs/04-security-privacy.md) §5.
Node 24 의 기본 TypeScript 지원으로 실행한다(빌드 없음, 런타임 의존성 없음).

## 실행

```
npm run guard          # --all    : git 추적 파일 전체 (CI)
npm run guard:staged   # --staged : 이번 커밋에 스테이징된 파일의 스테이징된 내용 (pre-commit)
npm run guard:bundle   # --bundle dist : 빌드 산출물 (Q-BUNDLE, `npm run build` 후)
```

위반이 하나라도 있으면 종료 코드 1. 끝에 검사별 요약표가 나온다.
출력에는 `파일:줄`과 **일부를 가린** 일치 문자열만 나온다(전체 노출 금지).

## 검사 목록

| ID  | 검사                 | 내용                                                                                                                                                             | 모드                     |
| --- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| G1  | 금지 경로            | `alrimjang/ records/ _source/ backups/ .ingest/`, `report/*.html`, `*.sqlite*`, `*.db`, `.dev.vars`, `.env`(`.env.example` 허용), `d1-export*.sql`               | staged·all               |
| G2  | 바이너리·문서        | `jpg jpeg png gif webp heic pdf xlsx xls docx mp4 mov zip`. 허용 폴더: `public/icons/`, `docs/img/`, `e2e/__screenshots__/`(스크린샷은 fixtures 로만)            | staged·all               |
| G3  | 패턴                 | 주민번호(마스킹형 포함), 휴대전화, 이메일(`users.noreply.github.com`·`example.com`·`example.org` 허용), 키즈노트 형태 URL. `package-lock.json` 은 본문 검사 제외 | 전부(번들은 이메일 제외) |
| G4  | denylist(로컬)       | `$DATA_DIR/.guard/denylist.txt` 의 단어가 본문·경로에 있으면 실패                                                                                                | `DATA_DIR` 필요          |
| G5  | 실제 문장 대조(로컬) | `$DATA_DIR/alrimjang/**/*.md` 본문과 `$DATA_DIR/tracking/observations.csv` 의 20자 창(공백 정리 후)이 검사 텍스트와 같으면 실패                                  | `DATA_DIR` 필요          |
| G6  | 비밀값               | `gitleaks` 가 PATH 에 있으면 `protect --staged` / `detect` 실행. 없으면 안내만(CI 는 gitleaks 액션)                                                              | 전부                     |
| G7  | 번들                 | `*.map` 금지, `kidsnote`(대소문자 무시) 금지, denylist·G5 적용, 한글 30자 이상 연속 구간은 `bundle-allowlist.txt` 에 있어야 통과                                 | bundle                   |

- G4·G5 는 `DATA_DIR` 환경변수가 있을 때만 동작한다. CI 에는 자료가 없으므로 **건너뛴다**(안내 한 줄).
  `DATA_DIR` 는 있는데 denylist 파일이 없으면 경고를 낸다(실패 아님).
- 텍스트가 아닌 파일(널 바이트 포함)과 2MB 초과 파일은 본문 검사를 하지 않는다.
- G5 는 창 20자 중 글자가 10자 미만이면(표 선·구분선 등) 대조하지 않는다. 해시 집합으로 대조하며
  색인이 800만 창을 넘으면 간격을 늘리고 경고한다.
- 설정은 [`config.ts`](config.ts). **허용 목록을 넓히려면 설계 담당 승인**이 필요하다(AGENTS.md §0-5).

## 관리자: denylist 만들기 (저장소 밖, 비공개)

1. `DATA_DIR` 아래에 `.guard` 폴더를 만들고 `denylist.txt` 를 만든다. 저장소 안에 두지 않는다.
2. 형식: UTF-8 텍스트, **한 줄에 단어(또는 구절) 하나**. 빈 줄과 `#` 로 시작하는 줄은 무시한다.
   대소문자는 구분하지 않고, 정규식이 아니라 **글자 그대로** 일치를 찾는다.
3. 아래는 형식 예시다(자리표시자). 실제 이름은 이 저장소의 어떤 파일에도 적지 않는다.

```
# $DATA_DIR/.guard/denylist.txt
테스트아이
테스트엄마
교사A
친구A
```

4. 확인: `DATA_DIR` 를 설정하고 `npm run guard` 를 실행해, 이 단어가 든 임시 파일을 `git add` 한 뒤
   `npm run guard:staged` 가 실패하는지 본다(확인 후 `git restore --staged` 로 되돌린다).

`DATA_DIR` 설정(Windows PowerShell 예): `$env:DATA_DIR = "<비공개 자료 경로>"` — 커밋하는 셸에 설정되어 있어야
pre-commit 의 G4·G5 가 동작한다. 영구 설정은 사용자 환경변수에 등록한다.

## pre-commit (husky)

`npm ci`/`npm install` 의 `prepare` 스크립트가 husky 를 설치하고, `.husky/pre-commit` 이
`npm run guard:staged` 를 실행한다. Windows Git Bash 에서도 동작한다(훅은 `sh` 스크립트).
`--no-verify` 로 우회하지 않는다. 우회해도 CI 의 `--all` 검사가 잡는다(단 G4·G5 는 로컬 전용).

## 한계

- G4·G5 는 CI 에서 돌지 않는다. 자료가 있는 PC 에서의 pre-commit 이 유일한 방어선이므로
  fixture 를 추가하는 PR 은 로컬 가드 통과 로그를 PR 에 첨부한다.
- 20자 미만 조각, 의역, 이미지 속 글자는 잡지 못한다.
- 번들 한글 장문 검사는 UI 문구를 허용 목록에 직접 적어야 하므로 새 긴 문구는 설계 담당 검토를 거친다.

## 테스트

`npm test` 의 `tools` 프로젝트(`guard.test.ts`)가 음성 대조(반드시 잡혀야 하는 경우)와
양성 대조(통과해야 하는 경우)를 합성 자료와 임시 `DATA_DIR` 로 검증한다.
