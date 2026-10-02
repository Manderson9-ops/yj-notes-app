# 장식 폰트 라이선스

두 폰트 모두 SIL Open Font License 1.1(OFL).
부분 집합(subset)으로 줄여 재배포한다.
원본은 google/fonts 저장소(`ofl/jua`, `ofl/gowunbatang`).

## yj-crayon-display.woff2

- 원본: Jua Regular
- 저작권: Copyright 2018 The Jua Project Authors
- 쓰는 테마: 크레용
- 라이선스 전문: `jua-OFL.txt`

## yj-forest-display.woff2

- 원본: Gowun Batang Bold
- 저작권: Copyright 2021 The Gowun Batang Project Authors
- 쓰는 테마: 숲
- 라이선스 전문: `gowunbatang-OFL.txt`

## 만드는 법·지키는 점

- 소스의 정적 UI 문구에 쓴 한글 + ASCII 만 남긴다.
- 다시 만들기: `npm run fonts:subset`
- 폰트 파일 자체를 단독으로 판매하지 않는다.
- 두 원본 모두 Reserved Font Name 이 없다.
- 수정본임을 드러내려고 `@font-face` 이름과 파일 이름을 바꿔 쓴다.
  (`YJ Crayon Display`, `YJ Forest Display`)
