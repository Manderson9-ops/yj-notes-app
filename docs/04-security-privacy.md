# 04. 보안·개인정보

> 이 문서의 규칙은 다른 모든 문서보다 우선한다. 충돌하면 이 문서를 따른다.

## 1. 지켜야 할 것

| 자산 | 등급 | 최악의 사고 |
|---|---|---|
| 알림장 원문·댓글(다른 아이·교사 포함) | S1 | 검색엔진·제3자에 노출 |
| 가족 기록, 보고서 인용 | S1 | 노출 |
| 검진 결과·결과통보서 사진 | S2 | 건강정보·식별번호 노출 |
| 키즈노트 세션 쿠키 | 비밀 | 계정 탈취 |
| Cloudflare API 토큰, PIN 해시, 세션 서명키 | 비밀 | 전체 자료 탈취·변조 |

## 2. 위협 모델 (STRIDE 요약)

| 위협 | 경로 | 대책 | 검증 |
|---|---|---|---|
| 공개 저장소로 자료 유출 | 실수 커밋, fixture 에 실제 자료 복사 | 자료는 저장소 밖(`DATA_DIR`), `tools/guard` pre-commit + CI 차단, PR 템플릿 확인란 | Q-GUARD |
| 정적 파일로 자료 유출 | 빌드물에 자료 포함, Functions 한도 초과 시 fail open | 자료는 D1/R2 에만, 빌드물 자료 검사, 대시보드 **Fail closed** | Q-BUNDLE, O-03 |
| PIN 우회 | 클라이언트 PIN, 직접 URL | 서버 검증, 모든 `/api/*` 미들웨어, 자료 URL 추측 불가 | Q-SEC |
| PIN 무차별 대입 | 4자리 = 1만 가지 | IP별 5회/15분 잠금 + **전역** 30회/시간 초과 시 1시간 전체 잠금 + 관리자 알림 | 단위 테스트 |
| 세션 탈취 | XSS, 네트워크 | HttpOnly·Secure·SameSite=Strict 쿠키, 엄격한 CSP, 보고서는 sandbox iframe | Q-CSP |
| CSRF | 다른 사이트에서 POST | SameSite=Strict + `Origin` 헤더 일치 확인 + JSON 전용 | 단위 테스트 |
| 기록 변조·삭제 | 세션 가진 사람의 실수 | 소프트 삭제·수정 이력, D1 Time Travel(7일) + 주간 내보내기 백업 | O-05 |
| 비밀값 유출 | 코드·로그·CI 출력 | Cloudflare secret·GitHub encrypted secret 만 사용, 로그에 요청 본문 금지, gitleaks | Q-GUARD |
| 키즈노트 쿠키 유출 | 클라우드 저장 | 쿠키를 저장하지 않음. 관리자 PC 브라우저 세션 안에서만 수집(`07`) | 설계 |
| 검색엔진 색인 | 공개 주소 | `noindex` 헤더·robots, 로그인 전 화면에 아이 정보 없음 | Q-SEC |

## 3. 접속 보호 (PIN 유지 결정 D-02 의 구현)

- **저장**: `PIN_HASH = PBKDF2-SHA256(pin, PIN_SALT, 100000회)` 를 Cloudflare secret 으로. 코드·저장소·브라우저에 PIN 없음.
  (Workers WebCrypto 의 PBKDF2 반복 상한 100,000 에 맞춤)
- **대조**: 상수 시간 비교. 실패 응답 지연 일정(약 400ms).
- **세션 쿠키** `yjs`: `base64url(payload).HMAC-SHA256(SESSION_SECRET)`,
  payload = `{v:1, epoch, iat, exp(30일), dev}`. 서버는 `app_setting.session_epoch` 와 같을 때만 수락.
- **전체 로그아웃**: epoch 증가(관리자 명령 또는 PIN 변경 시 자동).
- **시도 기록**: `auth_attempt` 에 IP 의 **솔트 해시**만 저장(원 IP 저장 안 함), 30일 후 삭제.
- **서버 설정 오류는 시도로 세지 않는다**: PIN_HASH/PIN_SALT 없음·형식 오류로 대조 자체를 못 한 요청은 `auth_attempt` 에 남기지 않고(없으면 기록 전 500, 형식 오류면 기록을 되돌린 뒤 500) 잠금 계산에서 뺀다. 실제로 틀린 PIN 만 실패 1회다.
- **자릿수 노출(`PIN_LENGTH`)**: `GET /api/session` 이 `pinLength`(4~12)를 알려 입력이 그 자리에서 자동 전송된다. 무차별 대입 공간을 줄이지 않는다 — 자릿수는 화면 점 개수로 원래 관찰 가능한 수준이고, 주 방어는 시도 제한(IP 5회/15분·전역 30회/시간)이다. 자동 전송 때문에 시도가 늘지 않게 클라이언트는 정확히 그 자리에서 1회만 전송하고 전송 중엔 입력을 막는다.
- **PIN 강도(R1-1)**: PIN 은 **무작위 6자리 이상**이어야 하며 생일·전화번호 같은 짐작 가능한 숫자는 쓰지 않는다.
  `npm run pin:hash` 는 6~12자리만 만들고 더 짧으면 이유를 설명하며 거부한다. 서버는 형식 검사만 4~12자리로 유지한다(기존 값 호환·형식 비노출). 로그인 화면(`PinScreen`)과 `PIN_LENGTH` 동작은 그대로다.
- **PIN_LENGTH 는 서버 판정에 쓰이지 않는다(R1-2)**: UI 힌트(점 개수·자동 전송)일 뿐이라 잘못 설정해도 서버는 PIN 을 거절하거나 실패로 세지 않는다. 또한 `PIN_HASH` 가 32바이트가 아니거나 `PIN_SALT` 가 8바이트 미만이면 설정 오류로 보고 시도 기록을 되돌린 뒤 500 을 낸다.

## 4. 응답 보안 헤더 (`functions/_middleware.ts`)

```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self';
  img-src 'self' data: blob:; frame-src 'self'; connect-src 'self';
  object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'
Strict-Transport-Security: max-age=31536000
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
X-Robots-Tag: noindex, nofollow
Permissions-Policy: camera=(), microphone=(), geolocation=()
Cache-Control: private, no-store        (모든 /api/*)
```

- 기존 보고서 HTML 은 인라인 스크립트를 쓰므로 **`/api/reports/:slug/raw` 를 `sandbox="allow-scripts"`(allow-same-origin 없음) iframe** 으로만 띄운다. 그 응답에만 별도 CSP(`script-src 'unsafe-inline'`, `connect-src 'none'`)를 준다. 응답 CSP 에도 `sandbox allow-scripts`·`form-action 'none'`·`base-uri 'none'` 을 넣어, 주소를 새 탭으로 직접 열어도 앱 origin 이 아닌 고유 origin 에서 실행된다(보안 검토 2026-10-02 P1).

### 4-1. 오프라인 대기열·서비스 워커 (F2-6)
- **서비스 워커(`public/sw.js`)는 앱 껍데기만 캐시한다**: 화면 HTML 과 해시가 붙은 빌드 파일(`/assets/`, `/fonts/`). **`/api/*` 는 건드리지 않는다**(항상 네트워크, 저장 안 함). 이유: 가족 기록·알림장은 S1 이라 기기 캐시에 오래 남으면 안 된다. 껍데기에는 자료가 없다(ADR-0002).
- **기록 대기열**은 IndexedDB(`yj-queue`)에 **아직 못 보낸 기록만** 두고, 보내면 지운다. 로그아웃해도 못 보낸 기록은 유실하지 않으려고 남기므로, 기기를 넘길 때는 먼저 연결해서 비우거나 브라우저 사이트 데이터를 지운다.
- 대기열·서비스 워커 모두 같은 출처 스크립트(`script-src 'self'`)만 쓴다. 인라인 스크립트 없음.
- 질문 정의(`log_type`)는 개인 자료가 아니라 `localStorage` 에 한 벌 기억해 오프라인에서도 입력 화면이 열린다.

## 5. 자료 분리 규칙 (공개 저장소 결정 D-01 의 구현)

1. 실제 자료 경로는 환경변수 `DATA_DIR` 로만 받는다. 기본값 없음 — 없으면 CLI 가 멈춘다.
2. 이 저장소에 **절대 두지 않는 것**: 알림장·관측·보고서·검진 원본과 파생물, 실제 아이·가족·교사·친구 이름, 실제 날짜와 결합된 기록, 키즈노트 응답, `.dev.vars`, `*.sqlite`, D1 내보내기.
3. (규칙 R3) `fixtures/` 는 **합성 자료만**: 아이 이름 `테스트아이`, 생일 `2020-01-15`, 교사 `교사A`, 친구 `친구A/B`. 실제 문장을 바꿔 쓰지 않고 새로 쓴다.
4. 기존 비공개 자료 저장소(`DATA_DIR`)의 git 이력에는 자료가 있다 → **그 저장소는 어떤 원격에도 푸시하지 않는다.** 신규 저장소는 이력 공유 없이 새로 시작했다.
5. 커밋 작성자 이메일은 GitHub noreply 주소를 쓴다(개인 메일 노출 방지).

### 자동 검사 (`tools/guard`)
| 검사 | pre-commit | CI |
|---|---|---|
| 금지 경로(`alrimjang/`, `records/`, `_source/`, `report/*.html`, `backups/`, `.ingest/`, `*.sqlite`, `*.db`, `.dev.vars`, `.env`) | ✅ | ✅ |
| **실제 문장 대조**: 커밋 대상 텍스트의 20자 이상 연속 구간이 `DATA_DIR` 알림장·관측 본문과 일치하면 차단 | ✅ | — (CI 에는 자료가 없다 → fixture PR 은 로컬 가드 통과 로그를 PR 에 첨부) |
| 이미지·문서 바이너리(`*.jpg/png/pdf/xlsx`) — `public/icons/`, `docs/img/` 허용목록 외 | ✅ | ✅ |
| 주민번호·전화·이메일 패턴 | ✅ | ✅ |
| **실명 목록 대조**: `$DATA_DIR/.guard/denylist.txt`(비공개, 저장소 밖) | ✅ | — (CI 에는 목록이 없다) |
| 비밀값(gitleaks) | ✅ | ✅ |
| 빌드물(`dist/`)에 S1 표지어·fixture 외 한글 장문 없음 | — | ✅ Q-BUNDLE |

## 6. 사고 기록과 대응

### INC-01 (2026-09-28 발견) 현행 정적 사이트의 PIN 우회
- 내용: 현행 정적 보고서 사이트의 PIN 이 브라우저 코드에 있어, 보고서 주소를 직접 입력하면 PIN 없이 열림. 알림장 인용(다른 아이 이름 포함) 노출 가능. (사이트 주소·파일명은 공개 저장소에 적지 않는다 — 관리자 비공개 운영 기록 참조)
- 결정(D-03): 신규 앱 완성까지 **현행 유지(위험 수용)**. 수용자: 관리자. 재검토: M5 또는 2026-11-30 중 빠른 날.
- 저비용 완화(관리자 선택 사항): 보고서 HTML 에 `noindex` 메타 추가, 사이트 주소 공유 범위 확인.

### 유출 의심 시 절차
1. 노출 지점 차단(Pages 배포 롤백 또는 프로젝트 일시 중지, R2 접근 확인)
2. 비밀값 교체: `SESSION_SECRET`·PIN(→ epoch 증가로 전원 로그아웃)·Cloudflare 토큰
3. 공개 저장소에 들어갔다면: 저장소 비공개 전환 → 이력 정리(git filter-repo) → GitHub 지원에 캐시 삭제 요청. **회수는 보장되지 않으므로 1단계 예방이 핵심.**
4. `docs/09-operations.md` 사고 기록표에 남긴다.

## 7. 법·약관 메모 (법률 자문 아님)
- 다른 아이 이름·사진이 담긴 알림장은 가정 내 열람 목적 범위에서만 다룬다. 외부 공유 기능을 만들지 않는다.
- 키즈노트 자료 자동 수집은 서비스 약관을 확인해야 한다(D-06). 1차는 본인 계정·본인 아이 기록을 수동 실행으로 내려받는 범위로 한정한다.
- K-DST 문항은 저작권·검사 오염 문제로 수집하지 않는다(기존 원칙 유지).
