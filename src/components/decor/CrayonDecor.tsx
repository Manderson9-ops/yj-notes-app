import type { ReactNode, SVGProps } from "react";

// 크레용 테마 장식 (docs/design/theme-crayon.md §3). 전부 직접 그린 오리지널 path.
// 사람·동물·얼굴·캐릭터·로고·채점 기호 없음. 색은 CSS 클래스(토큰)로 칠한다.

export function Svg({
  children,
  className,
  ...rest
}: SVGProps<SVGSVGElement> & { children: ReactNode }) {
  return (
    <svg
      className={className ? `decor ${className}` : "decor"}
      aria-hidden="true"
      focusable="false"
      xmlns="http://www.w3.org/2000/svg"
      {...rest}
    >
      {children}
    </svg>
  );
}

/** 살짝 물결진 굵은 선. wide=머리글 아래, short=활성 탭 아래(그려지는 모션). */
export function CrayonUnderline({ variant }: { variant: "wide" | "short" }) {
  return variant === "wide" ? (
    <Svg className="decor-header" viewBox="0 0 320 12" preserveAspectRatio="none">
      <path
        className="d-line"
        vectorEffect="non-scaling-stroke"
        strokeWidth="4"
        d="M3 7 C26 3 49 10 82 6 C112 3 139 8 170 5 C203 2 232 9 262 6 C285 4 303 7 317 5"
      />
    </Svg>
  ) : (
    <Svg className="decor-tab" viewBox="0 0 40 8">
      <path
        className="d-line"
        pathLength="1"
        strokeWidth="3.4"
        d="M3 5 C9 2.5 14 6.5 21 4 C27 2 32 6 37 3.5"
      />
    </Svg>
  );
}

/** 비뚤어진 별 */
export function DoodleStar() {
  return (
    <Svg viewBox="0 0 64 64">
      <path
        className="d-ink d-f3"
        d="M32 4.5 L39.5 22.5 L59 25 L44 37.5 L48.5 56.5 L31 46 L15 56 L20 37 L5 24 L24.5 23.5 Z"
      />
    </Svg>
  );
}

/** 손으로 그린 구름 */
export function DoodleCloud() {
  return (
    <Svg viewBox="0 0 96 56">
      <path
        className="d-ink d-f2"
        d="M18 47 C5 47 3 31 15 28 C13 15 31 8 39 19 C44 5 67 8 68 23 C83 20 93 34 83 43 C80 48 74 47 70 46 C54 49 36 48 18 47 Z"
      />
    </Svg>
  );
}

/** 해: 둥근 몸통 + 짧은 선 여덟 개(얼굴 없음) */
export function DoodleSun() {
  return (
    <Svg viewBox="0 0 72 72">
      <path
        className="d-ink d-f3"
        d="M36 20 C45 19 53 26 52 36 C52 46 44 53 35 52 C26 52 19 44 20 35 C20 27 27 20 36 20 Z"
      />
      <path
        className="d-line"
        strokeWidth="2.5"
        d="M36 5 L35 12 M56 14 L51 19 M67 36 L60 37 M57 58 L52 53 M36 68 L37 60 M14 58 L20 53 M5 35 L12 36 M15 14 L21 20"
      />
    </Svg>
  );
}

/** 크레용 한 자루: 원통 + 뾰족 끝 + 종이 띠 */
export function CrayonStick() {
  return (
    <Svg viewBox="0 0 120 40">
      <path className="d-ink d-f1" d="M20 12 L85 10 L86.5 31 L21 31.5 C15 28 15 15 20 12 Z" />
      <path className="d-ink d-f1" d="M85.5 10.5 L111 20.5 L86 30.5 Z" />
      <path className="d-ink d-paper" d="M40 11.5 L57 11 L58 30.5 L41 31 Z" />
      <path className="d-line" strokeWidth="2" d="M104 18.5 L111 20.5 L105 23" />
    </Svg>
  );
}

/** 집: 삼각 지붕 + 네모 + 창 2개 + 문 */
export function DoodleHouse() {
  return (
    <Svg viewBox="0 0 96 80">
      <path className="d-ink d-f2" d="M18 38 L18.5 72 L78 71 L77 37 Z" />
      <path className="d-ink d-f1" d="M8 40.5 L48 8.5 L89 39 L84 43 L48 17.5 L12.5 44 Z" />
      <path className="d-ink d-f3" d="M23 48 L35 47.5 L35.5 59 L22.5 59.5 Z" />
      <path className="d-ink d-f3" d="M62 47.5 L74 48 L73.5 59.5 L62 59 Z" />
      <path className="d-ink d-paper" d="M42 72 L42.5 54 L55 53.5 L55 71.5 Z" />
    </Svg>
  );
}

/** 기울어진 우산(펼친 채): 갓 + 손잡이 */
export function DoodleUmbrella() {
  return (
    <Svg viewBox="0 0 80 80">
      <g transform="rotate(-18 40 44)">
        <path className="d-line" strokeWidth="3" d="M40 38 L41.5 66 C42.3 74 51 74 51.5 67" />
        <path
          className="d-ink d-f1"
          d="M7 40 C9 19 36 8 57 17 C68 23 73 32 73 40 C67 35 62 36 56.5 40 C51 35 45 35 40 40 C34 35 29 35 23.5 40 C18 35 13 36 7 40 Z"
        />
      </g>
    </Svg>
  );
}

/** 튀는 공: 동그란 공 + 땅 그림자 + 움직임 선 두 줄 */
export function DoodleBall() {
  return (
    <Svg viewBox="0 0 88 72">
      <path className="d-line" strokeWidth="2.5" d="M8 20 L21 24 M5 36 L18 36" />
      <path className="d-line" strokeWidth="2.5" d="M31 63 C41 67 53 67 63 62" />
      <path
        className="d-ink d-f3"
        d="M45 12 C57 11 66 21 66 32 C66 44 57 52 45 52 C33 52 24 43 24 32 C24 21 33 13 45 12 Z"
      />
      <path className="d-line" strokeWidth="2" d="M26 30 C38 37 52 37 65 29" />
    </Svg>
  );
}

/** 물웅덩이: 납작한 물 모양 + 물결 두 줄 */
export function DoodlePuddle() {
  return (
    <Svg viewBox="0 0 96 40">
      <path
        className="d-ink d-sky"
        d="M6 28 C4 18 20 12 34 15 C44 8 66 9 74 17 C90 17 94 27 84 31 C72 37 40 38 20 35 C12 34 7 32 6 28 Z"
      />
      <path
        className="d-line"
        strokeWidth="2"
        d="M28 25 C36 22 46 22 54 25 M58 29 C64 27 70 27 76 29"
      />
    </Svg>
  );
}
