# 02. 아키텍처

## 1. 구성도

```
┌──────────────── 가정 PC (관리자) ────────────────┐
│ Google Drive: DATA_DIR (비공개 자료 저장소, git)    │
│   alrimjang/ evidence/ tracking/ guide/ wiki/      │
│   report/ records/ _source/                         │
│        │ 기존 Python 파이프라인(수집·생성·검증)       │
│        ▼                                            │
│ yj-notes-app/tools/ingest  (이 저장소의 CLI)        │
│   export → verify → upload  (DATA_DIR 환경변수)     │
└────────┬───────────────────────────────────────────┘
         │ wrangler (관리자 API 토큰, PC 에만 저장)
         ▼
┌──────────────── Cloudflare (무료) ────────────────┐
│ D1  yj-notes-db   : 알림장·기록·검진·성장·근거      │
│ R2  yj-notes-private : 보고서 HTML·검진 원본 사진   │
│ Pages yj-notes-app : 정적 앱 껍데기 (자료 없음)      │
│   Functions /api/*  : PIN 세션 확인 → D1/R2 조회    │
└────────▲───────────────────────────▲──────────────┘
         │ GitHub Actions(코드만 배포)   │ HTTPS + 세션 쿠키
┌────────┴──────────┐            ┌────┴─────────────┐
│ GitHub 공개 저장소  │            │ 가족 휴대폰 (PWA) │
│ 코드·설계·가짜 자료 │            └──────────────────┘
└───────────────────┘
```

## 2. 핵심 설계 결정

| # | 결정 | 이유 | ADR |
|---|---|---|---|
| A1 | 코드(공개)와 자료(비공개)를 **물리적으로 분리** | 공개 저장소 선택(D-01). 한 번 푸시된 자료는 회수 불가 | 0001 |
| A2 | 아이 자료는 **정적 파일로 배포하지 않고** Functions 경유로만 제공 | 무료 한도 초과 시 Pages 가 Functions 없이 정적 파일을 내보내는 "fail open" 위험. 정적 껍데기에는 자료가 없으므로 노출되지 않는다 | 0002 |
| A3 | PIN 은 **서버 검증 + 서명 세션 쿠키** | 현행 사이트는 PIN 이 브라우저 코드에 있어 우회 가능(사고 INC-01) | 0003 |
| A4 | 저장소: **D1(정형) + R2(문서·이미지)** | 무료, Pages 와 같은 계정, SQL 로 "숫자는 자료에서 센다"(P3) 구현 | 0004 |
| A5 | 기존 Python 파이프라인을 **대체하지 않고 적재만** 한다 | 검증 스크립트(T1~T7·R1~R11 등)가 이미 신뢰를 만든다. 재구현은 오류만 늘린다 | 0005 |
| A6 | 키즈노트 수집은 **가정 PC 에서 반자동** | 키즈노트 세션 쿠키를 클라우드에 두지 않는다. 약관·차단 위험 최소화 | 0006 |

## 3. 기술 스택

| 층 | 선택 | 대안과 기각 이유 |
|---|---|---|
| 프런트 | React 19 + Vite + TypeScript(strict) | Next.js: Pages 어댑터·SSR 불필요, 복잡도만 증가 |
| 스타일 | CSS Modules + 디자인 토큰(CSS 변수) | Tailwind: 조부모용 큰 글씨 토큰을 한곳에서 통제하기에 CSS 변수가 단순 |
| 라우팅 | React Router | — |
| 서버 상태 | TanStack Query | 캐시·재시도·오프라인 재전송 일관 |
| 오프라인 | 직접 쓴 최소 Service Worker(`public/sw.js`, 앱 껍데기만 캐시) + IndexedDB 대기열(라이브러리 없음). 의존성을 늘리지 않으려 vite-plugin-pwa 는 쓰지 않았다 | F2-6 |
| 차트 | uPlot | 성장 곡선 1종, 가볍다(Recharts 대비 번들 작음) |
| 마크다운 | markdown-it + DOMPurify | guide/wiki 렌더링, XSS 차단 |
| API | Pages Functions + Hono | 라우팅·미들웨어 정리. 런타임 의존성 최소 |
| 검증 | zod (요청·응답 스키마 공유) | 프런트·서버 같은 타입 |
| DB 접근 | D1 prepared statement + SQL 마이그레이션 | ORM 없이 SQL 을 문서와 1:1 대응 |
| 테스트 | Vitest, @cloudflare/vitest-pool-workers, Playwright | `08-quality.md` |
| 적재 CLI | Python 3.11 (`tools/ingest`) | 기존 파이프라인과 같은 언어·같은 PC |

## 4. 저장소 구조

```
yj-notes-app/
├─ AGENTS.md              코딩 에이전트 규칙(필독)
├─ docs/                  설계 문서 01~10, adr/
├─ src/                   프런트(React)
│  ├─ app/  pages/  components/  lib/  styles/tokens.css
├─ functions/             Pages Functions
│  ├─ _middleware.ts      보안 헤더 + 세션 확인(모든 /api/*)
│  └─ api/[[route]].ts    Hono 앱 진입점
├─ server/                Functions 가 쓰는 순수 로직(테스트 대상)
│  ├─ auth/  routes/  db/  schemas/
├─ migrations/            D1 SQL 마이그레이션 0001_*.sql …
├─ tools/ingest/          Python 적재 CLI (DATA_DIR 필요)
├─ tools/guard/           자료 유출 방지 검사(pre-commit·CI)
├─ fixtures/              합성(가짜) 데이터 — 실제 이름·날짜 금지
├─ tests/  e2e/
└─ .github/workflows/     ci.yml, deploy.yml
```

## 5. 데이터 흐름

### 5.1 읽기 (가족)
1. 휴대폰 → `GET /` : 정적 앱 껍데기(자료 없음)
2. 앱 → `GET /api/session` : 세션 없으면 PIN 화면
3. `POST /api/session` (PIN) → 서버가 해시 대조 → `Set-Cookie: yjs=…; HttpOnly; Secure; SameSite=Strict`
4. 이후 모든 `/api/*` 는 미들웨어가 쿠키 서명·만료·세션 세대(`session_epoch`)를 확인 → D1/R2 조회

### 5.2 쓰기 (가족 기록)
`POST /api/logs` → zod 검증 → D1 `family_log` INSERT(기록자·기기 ID·클라이언트 UUID로 멱등) → 요약 재계산은 조회 시 SQL 집계

### 5.3 적재 (관리자 PC)
`ingest export` → `ingest verify` → `ingest upload`. 상세 `07-kidsnote-sync.md`.

### 5.4 배포 (코드)
`main` 병합 → CI(테스트·가드) 통과 → `deploy.yml` 이 Pages 에 배포. 자료는 배포물에 포함되지 않는다.

## 6. 무료 한도와 예상 사용량 (2026-09 확인)

| 자원 | 무료 한도 | 예상 사용량 | 여유 |
|---|---|---|---|
| Functions 요청 | 100,000/일 (Workers 와 합산) | 가족 4명 × 하루 수백 | 충분 |
| D1 읽기 | 5,000,000행/일 (초과 시 2026-09-01부터 쿼리 실패) | 검색 1회 ≈ 500행 | 충분 |
| D1 쓰기 | 100,000행/일 | 적재 1회 ≈ 3,000행 | 충분 |
| D1 저장 | DB 당 500MB, 계정 5GB | 수 MB(텍스트) | 충분 |
| R2 | 10GB-월, 쓰기 100만/월, 읽기 1,000만/월 | 보고서·검진 사진 수십 MB | 충분 |
| 정적 요청 | 무제한 | — | — |

- 출처: Cloudflare Pages Functions routing·pricing, D1 pricing·limits, R2 pricing 문서(2026-09 열람).
- **Functions 한도 초과 시 동작은 "Fail closed" 로 설정한다**(대시보드 Settings > Runtime). 운영 점검표 `09-operations.md` O-03.
- 사진·동영상(약 10.5GB)은 R2 무료 한도를 넘으므로 1차 범위에서 제외.

## 7. 기존 사이트와의 관계

| 항목 | 현행 정적 보고서 사이트 | 신규 `yj-notes-app` |
|---|---|---|
| 형태 | 정적 HTML (보고서 3종) | PWA + API |
| 보호 | 브라우저 PIN(우회 가능) | 서버 PIN 세션 |
| 전환 | M5 에서 신규 앱 검수 후 현행 프로젝트의 보고서 페이지를 내리고 안내 페이지로 교체 (결정 D-03) | |
