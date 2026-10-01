# ADR-0002: 아이 자료를 정적 파일로 배포하지 않음

- 상태: 승인 (2026-09-28)
- 관련: docs/02-architecture.md, docs/04-security-privacy.md

## 배경
Pages 무료 요금제에서 Functions 일일 한도를 넘으면 "fail open" 일 때 Functions 를 건너뛰고 정적 파일을 내보낸다. 정적 파일에 자료가 있으면 인증이 무력화된다.

## 결정
빌드물(`dist/`)은 자료 없는 앱 껍데기만. 모든 자료는 `/api/*`(Functions) 를 거쳐 D1/R2 에서 읽는다. 대시보드는 Fail closed 로 설정한다(O-03). CI 의 Q-BUNDLE 이 빌드물을 검사한다.

## 결과
한도 초과·설정 실수 어느 쪽에서도 자료가 새지 않는다(이중 방어). 대신 보고서 HTML 도 API 경유라 요청이 Functions 한도에 포함된다(가족 규모에서 문제 없음).

## 검토한 대안
미들웨어로 정적 보고서 보호(기각: fail open 시 노출), Cloudflare Access(기각: 사용자 결정 D-02 PIN 유지).