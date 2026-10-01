# yj-notes-app

가정용 **아이 발달 기록 웹앱**. 어린이집 알림장·발달 근거 DB·가족 관찰 기록을 한곳에서 보고, 휴대폰으로 기록한다.

> 이 저장소는 **공개**다. 아이의 실제 기록은 이 저장소에 **절대 들어오지 않는다.**
> 코드·설계·합성(가짜) 테스트 데이터만 있다. 실제 자료는 가정의 비공개 저장소(Google Drive)와
> Cloudflare 비공개 저장소(D1·R2)에만 있다. 규칙: [`docs/04-security-privacy.md`](docs/04-security-privacy.md)

## 상태

| 항목 | 상태 |
|---|---|
| 단계 | **M1 진행 중 (T-01 완료)** |
| 배포 | 아직 없음 (기존 정적 보고서 사이트가 별도로 운영 중) |
| 라이선스 | 결정 대기 (`docs/10-roadmap.md` 결정 목록 D-04) |

## 개발 시작

필요: **Node 24 LTS** (`.nvmrc`, `engines`: `>=24 <25`), npm 11.

```
npm ci                 # 의존성 설치 (정확한 버전 고정)
npm run dev            # 개발 서버 http://127.0.0.1:5173
npm run check          # 타입 + 린트 + 포맷 + 단위 테스트
npm run build          # 프로덕션 빌드 (dist/)
npx playwright install chromium webkit   # 최초 1회
npm run test:e2e       # 모바일(360px) E2E

# 로컬 DB (D1 시뮬레이터, .wrangler/state — git 무시)
npm run db:migrate:local   # migrations/ 적용
npm run db:seed:local      # 합성 fixture 적재
npm run db:reset:local     # 로컬 DB 삭제 후 migrate + seed
```

> 운영 DB 마이그레이션 `npm run db:migrate:prod` 는 **관리자만, 실행 전 백업(docs/09) 후** 수행한다. 개발·에이전트는 `--local` 만 쓴다.
> 비밀값은 `.dev.vars.example` 를 `.dev.vars` 로 복사해 채운다.

> `npm run guard`(유출 방지 검사)는 T-02 에서 추가되며, 그때 `check` 에 포함된다.
## 문서

| # | 문서 | 내용 |
|---|---|---|
| 01 | [요구사항](docs/01-requirements.md) | 사용자·범위·기능 요구·품질 기준 |
| 02 | [아키텍처](docs/02-architecture.md) | 구성도·데이터 흐름·기술 선택 |
| 03 | [데이터 모델](docs/03-data-model.md) | D1 스키마·R2 객체·자료 등급 |
| 04 | [보안·개인정보](docs/04-security-privacy.md) | 위협 모델·PIN·자료 분리·사고 대응 |
| 05 | [API](docs/05-api.md) | 엔드포인트 계약 |
| 06 | [화면](docs/06-ui.md) | 화면 목록·모바일 기준·접근성 |
| 07 | [키즈노트 동기화](docs/07-kidsnote-sync.md) | 수집·적재 파이프라인 |
| 08 | [품질](docs/08-quality.md) | 테스트·품질 게이트·완료 정의 |
| 09 | [운영](docs/09-operations.md) | 배포·백업·복구·런북 |
| 10 | [로드맵](docs/10-roadmap.md) | 마일스톤·작업 카드·결정 목록 |
| ADR | [docs/adr/](docs/adr/) | 설계 결정 기록 |

코딩 에이전트·기여자는 먼저 [`AGENTS.md`](AGENTS.md)를 읽는다.

## 한 줄 구성

```
[가정 PC: 비공개 자료(Drive)] --ingest CLI--> [Cloudflare D1/R2 (비공개)]
                                                     ^
[GitHub 공개: 코드] --CI 배포--> [Cloudflare Pages + Functions] --PIN 세션--> [가족 휴대폰]
```
