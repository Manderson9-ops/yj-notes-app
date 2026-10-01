# 기여 안내

## 먼저 읽을 것

[`AGENTS.md`](AGENTS.md)를 먼저 읽는다. 특히 §0 절대 규칙(공개 저장소, 실제 자료 금지, 비밀값 금지)은 사람·에이전트 모두 해당한다.

## 작업 흐름

1. [`docs/10-roadmap.md`](docs/10-roadmap.md)의 **작업 카드 1장 = 브랜치 1개 = PR 1개**.
2. 브랜치명은 `t-XX-짧은-설명` (예: `t-02-guard`).
3. 시작 전 카드의 "입력 문서"를 읽는다. 모호하면 추측하지 말고 PR 초안에 질문을 적는다.
4. 설계와 다르게 구현해야 하면 문서를 먼저 고치는 PR 을 낸다(필요 시 `docs/adr/`).
5. PR 템플릿의 "개인정보·보안 체크"를 빠짐없이 채운다.

## 커밋

- [Conventional Commits](https://www.conventionalcommits.org/ko/): `feat:`, `fix:`, `test:`, `docs:`, `chore:`. 한국어 본문 가능.
- **커밋 작성자 이메일은 GitHub noreply 주소**를 쓴다(개인 메일 노출 방지).
  `git config user.email "<ID>+<사용자명>@users.noreply.github.com"`
- 커밋 전 `npm run guard` 가 통과해야 한다(T-01 이후 사용 가능).

## 완료 정의 (DoD)

[`docs/08-quality.md`](docs/08-quality.md) §4 를 따른다. 요약: 수용 기준 충족, 타입·린트·단위·가드 통과, 새 API 는 zod + 문서 갱신, 새 화면은 360px 스크린샷(합성 자료만).

## 리뷰

- 보안 경계 파일(`functions/_middleware.ts`, `server/auth/**`, `tools/guard/**`, `tools/ingest/**`) 변경은 설계 담당(Opus) 검토 없이 병합하지 않는다.
- 자료가 노출되었거나 취약점을 발견하면 공개 글이 아니라 [`SECURITY.md`](SECURITY.md) 절차로 신고한다.
