# ADR-0003: PIN 을 서버에서 검증하고 서명 세션 쿠키 발급

- 상태: 승인 (2026-09-28)
- 관련: docs/02-architecture.md, docs/04-security-privacy.md

## 배경
현행 사이트는 PIN 이 브라우저 스크립트에 있어 주소 직접 입력으로 우회된다(INC-01). 사용자는 개인 계정 대신 가족 PIN 유지를 택했다(D-02).

## 결정
PBKDF2(100k) 해시를 Cloudflare secret 으로 보관, 상수시간 대조, IP별·전역 시도 제한, HMAC 서명 쿠키(HttpOnly·Secure·SameSite=Strict, 30일), `session_epoch` 로 전원 로그아웃.

## 결과
PIN 편의성을 유지하면서 우회를 막는다. 4자리 PIN 자체의 추측 가능성은 남으므로 6자리 이상 권고와 시도 제한으로 완화한다.

## 검토한 대안
Cloudflare Access 이메일 OTP(보안 우수, 사용자 결정으로 보류 — 추후 전환 가능하도록 미들웨어에 인증 방식을 분리), 서버 세션 테이블(기각: 상태 없는 서명 쿠키 + epoch 로 충분).