# 09. 운영

## 1. 환경

| 환경 | Pages 프로젝트 | D1 | R2 | 자료 |
|---|---|---|---|---|
| local | `wrangler pages dev` | 로컬(Miniflare) | 로컬 | fixtures 만 |
| preview | PR 미리보기 | `yj-notes-db-preview` | `yj-notes-private-preview` | fixtures 만 |
| production | `yj-notes-app` (production 브랜치 `main`) | `yj-notes-db` (ID 는 `wrangler.toml`) | `yj-notes-private` — **M4 활성화 예정**(R2 미사용, 바인딩 주석 처리) | 실제(S1/S2) |

- 미리보기 환경에는 **실제 자료를 절대 적재하지 않는다**(PR 미리보기 주소는 추측 가능). 미리보기 자원은 M2 이후 만들며 그때까지 `wrangler.toml` 의 `env.preview` 는 주석 처리.

## 2. 비밀값

| 이름 | 위치 | 교체 주기 |
|---|---|---|
| `PIN_HASH`, `PIN_SALT` | Cloudflare Pages secret | PIN 변경 시 |
| `SESSION_SECRET` | Cloudflare Pages secret | 6개월 또는 사고 시 |
| `IP_HASH_SALT` | Cloudflare Pages secret | 1년 |
| `CLOUDFLARE_API_TOKEN` (배포용, Pages 편집만) | GitHub Actions secret | 1년 |
| `CLOUDFLARE_API_TOKEN` (적재용, D1·R2 편집) | 관리자 PC 환경변수만 | 1년 |

- 배포 토큰과 적재 토큰을 **분리**한다. GitHub 에는 D1·R2 권한이 없는 토큰만 둔다.
- PIN 해시 생성: `npm run pin:hash` (로컬에서 입력, 화면 출력만, 파일 저장 안 함).

## 3. 배포
- 코드: `main` 병합 → `deploy.yml` → Pages production. 실패 시 Cloudflare 대시보드에서 이전 배포로 **롤백(1클릭)**.
- 스키마: `migrations/` 새 파일 → `npm run db:migrate:prod`(관리자 PC, 적재 토큰) → 코드 배포. **역방향 호환 마이그레이션만**(열 추가 O, 삭제는 두 단계로).
- 자료: `07` 파이프라인.

### 3-1. 최초 배포 절차 (관리자)
1. Cloudflare 대시보드 > Workers & Pages > Create > Pages > **Direct Upload** 로 프로젝트 `yj-notes-app` 생성, production 브랜치 `main`.
2. 운영 DB 마이그레이션(적재 토큰 환경): `npm run db:migrate:prod`
3. 비밀값 설정(각각 입력 프롬프트에 붙여넣기). 값 생성(화면 출력만, 파일 저장 없음):
   - PIN: `npm run pin:hash` → 출력된 `PIN_SALT`, `PIN_HASH`
   - 무작위 값(두 번 실행해 각각 사용): `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`
   - 등록: `npx wrangler pages secret put PIN_HASH --project-name yj-notes-app` (같은 방식으로 `PIN_SALT`, `SESSION_SECRET`, `IP_HASH_SALT`)
4. GitHub 저장소 Settings > Secrets and variables > Actions 에 `CLOUDFLARE_API_TOKEN`(권한 **Account > Cloudflare Pages: Edit** 만), `CLOUDFLARE_ACCOUNT_ID` 등록. Settings > Environments 에 `production` 생성(필요하면 승인자 지정). 비밀값이 없으면 `deploy.yml` 은 "배포 비밀값 미설정 — 건너뜀" 을 알리고 성공 종료한다(배포 안 함).
5. **O-03**: 대시보드 > Workers & Pages > `yj-notes-app` > Settings > Runtime > **Fail open/closed → "Fail closed"**.
6. 첫 배포: `main` 병합 후 `deploy.yml` 자동 실행(또는 Actions 에서 수동 실행). 급하면 관리자 PC 에서 `npm run deploy:prod`.
7. 확인: `https://yj-notes-app.pages.dev/api/health` 가 200, `/robots.txt` 가 `Disallow: /`, 로그인 전 `/api/*` 가 401.
8. R2 는 M4 에서 대시보드 R2 활성화 후 `wrangler.toml` 의 `FILES` 주석 해제.

### 3-2. Functions 실행 범위와 무료 한도
- 보안 헤더 미들웨어(`functions/_middleware.ts`)를 **모든 요청**(정적 파일 포함)에 적용하려고 `_routes.json` 을 두지 않는다. 따라서 Functions 가 모든 요청에서 실행된다.
- Pages Functions 는 Workers 무료 한도(일 100,000 요청)를 **공유**한다. 정적 파일 요청도 포함되므로 O-04 에서 사용량을 본다.
- `public/robots.txt`(`Disallow: /`)가 빌드 결과 `dist/` 에 포함된다.
## 4. 운영 점검표

| ID | 주기 | 점검 |
|---|---|---|
| O-01 | 배포마다 | CI 녹색, Q-SEC 통과 |
| O-02 | 주 1회 | 마지막 동기화 날짜, `ingest status` 건수 일치 |
| O-03 | 최초·설정 변경 시 | 대시보드 > Workers & Pages > `yj-notes-app` > Settings > Runtime > Fail open/closed → **"Fail closed"**, R2 공개 접근 꺼짐, r2.dev 주소 꺼짐 |
| O-04 | 월 1회 | Cloudflare 사용량(Functions·D1·R2) 무료 한도의 50% 미만 |
| O-05 | 주 1회(자동) | D1 내보내기 → 관리자 PC Drive `backups/d1/YYYY-MM-DD.sql` (가족 기록 보호) |
| O-06 | 분기 1회 | 백업 복구 연습(preview DB 에 복원 후 건수 대조 — 단, **가족 기록 복원 연습은 로컬에서만**) |
| O-07 | 주 1회 / 반기 1회 | Dependabot PR 검토·병합(주간, minor·patch 묶음) / 비밀값 교체·메이저 버전 업데이트(반기) |

## 5. 런북

| ID | 증상 | 조치 |
|---|---|---|
| R-01 | 가족이 "PIN 이 안 돼요" | 잠금 여부 확인(`auth_attempt`) → 15분 대기 안내. 전역 잠금이면 공격 의심 → 로그 확인 후 PIN 교체 |
| R-02 | 적재 실패(`ingest_run.status=failed`) | 오류 메시지 확인 → D1 Time Travel 로 적재 직전 시점 복원(`wrangler d1 time-travel restore`) → 원인 수정 후 재적재 |
| R-03 | 503 quota_exceeded | 사용량 확인. 반복되면 원인(루프 요청 등) 수정. 유료 전환은 관리자 결정 |
| R-04 | 기록이 사라졌다 | `deleted_at` 확인(소프트 삭제 복구) → 없으면 주간 백업에서 해당 id 복원 |
| R-05 | 유출 의심 | `04` §6 절차 |
| R-06 | 키즈노트 수집 실패 | 브라우저 로그인 상태 확인 → API 응답 형식 변경이면 수집 단계 수정, 적재는 보류 |

## 6. 사고·변경 기록
| 날짜 | ID | 내용 | 조치 | 상태 |
|---|---|---|---|---|
| 2026-09-28 | INC-01 | 현행 정적 사이트 PIN 우회 가능 | 위험 수용(D-03), 신규 앱에서 해소 | 열림 |
