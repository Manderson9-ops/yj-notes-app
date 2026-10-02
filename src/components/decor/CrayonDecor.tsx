import type { ReactNode, SVGProps } from "react";

// 크레용 테마 장식 (docs/design/theme-crayon.md §3). 전부 직접 그린 오리지널 path.
// 사람·동물·얼굴·캐릭터·로고·채점 기호 없음. 색은 CSS 클래스(토큰)로 칠한다.

/** 크레용 결: 미리 만든 작은 점·짧은 선 패턴(<pattern>)을 마스크로 써 채움·선 일부가 비쳐 보이게(거친 질감).
 *  실시간 feTurbulence 필터는 쓰지 않는다(저사양·소프트웨어 렌더 비용, docs/design/theme-system.md). 장식 SVG 안에서만 쓴다. */
// 점·짧은 선 좌표(29×29 타일, 고정 시드로 한 번 뽑아 붙임). 점 = 길이 0.01 선을 둥근 끝으로 그린 것.
const GRAIN_DOTS_A =
  "M0.6 0.5h.01M15.8 18.4h.01M26.4 3.3h.01M14.4 15.9h.01M17.3 22.7h.01M1.2 21.6h.01M28 2.1h.01M20.3 13.3h.01M11.5 27.8h.01M28.8 19.2h.01M12.3 14.5h.01M8.3 12.3h.01M19.6 4.5h.01M2.6 24.7h.01M9 0.2h.01M13.4 8.5h.01M16.6 27.9h.01M0.4 22.6h.01M8.8 9.3h.01M27.7 15.9h.01M19.4 19.1h.01M18.1 4.7h.01M26.9 22.3h.01M13.3 21h.01M9.6 20.7h.01M12.8 6h.01M13.3 19.5h.01M15.1 25.3h.01M11.4 26.8h.01M21.5 4.1h.01M19.9 10.2h.01M10.4 23h.01M23.1 5.1h.01M3.5 11.7h.01M25.4 21h.01M15.5 7.2h.01M11.4 25.2h.01M23.6 10.8h.01M24.1 20.1h.01M18.3 26.7h.01M23.9 2.8h.01M17.9 17.7h.01M3.3 16.8h.01M25.8 2.7h.01M8 22.6h.01M21.2 10.9h.01M5.2 8.2h.01M25.6 11.4h.01M22.5 20.8h.01M24.4 16.2h.01M6.2 26.2h.01M11.6 5.9h.01M19.7 23.8h.01M19.1 0.6h.01M10.2 3.2h.01M28.6 8.8h.01M9.8 27h.01M26.2 5.4h.01M21 17.5h.01M12.2 10h.01M19 13h.01M13.9 14.2h.01";
const GRAIN_DOTS_B =
  "M10.8 10.3h.01M27.4 11.1h.01M3.4 18.1h.01M24.7 4.1h.01M16.7 18.5h.01M13.1 13.3h.01M16.7 10.5h.01M18.4 3.6h.01M9 5.3h.01M16.8 0h.01M2.9 25.3h.01M7.2 26.5h.01M2.7 10.3h.01M6.2 4.2h.01M22.3 6.4h.01M0.4 9.6h.01M17.1 11h.01M19.7 21.1h.01M3.4 2.8h.01M11.4 2.2h.01M7.9 22.4h.01M7.8 15.3h.01M9.3 12h.01M21.3 21.6h.01M28.7 2.7h.01M7 11.2h.01M25.2 27h.01M12.1 17.1h.01M5.9 20.7h.01M21.3 24.8h.01";
const GRAIN_STROKES =
  "M9.1 12.2l0.8 2.4M4.3 15.5l-2.2 0.1M8.6 9.4l-1 1.5M24.2 15.1l-1.8 1M21.6 20.6l-1.8 0.3M24.2 0.2l-0.7 1.1M25.1 3.2l-0.3 2M26.1 4.3l1.7 1.1M13.6 9.7l-0.6 1.8M20.1 16.7l1 1.3M15.1 10.8l0.7 1.1M5.4 5.9l-1.6 0.3";

function CrayonGrain() {
  return (
    <defs>
      <pattern id="yj-crayon-tex" width="29" height="29" patternUnits="userSpaceOnUse">
        <rect width="29" height="29" fill="#e2e2e2" />
        <g fill="none" stroke="#000" strokeLinecap="round">
          <path strokeWidth="1" strokeOpacity="0.7" d={GRAIN_DOTS_A} />
          <path strokeWidth="0.75" strokeOpacity="0.9" d={GRAIN_DOTS_B} />
          <path strokeWidth="0.5" strokeOpacity="0.7" d={GRAIN_STROKES} />
        </g>
      </pattern>
      <mask
        id="yj-crayon-grain"
        maskUnits="userSpaceOnUse"
        x="-10"
        y="-10"
        width="740"
        height="200"
      >
        <rect x="-10" y="-10" width="740" height="200" fill="url(#yj-crayon-tex)" />
      </mask>
    </defs>
  );
}

export function Svg({
  children,
  className,
  grain = false,
  ...rest
}: SVGProps<SVGSVGElement> & { children: ReactNode; grain?: boolean }) {
  return (
    <svg
      className={className ? `decor ${className}` : "decor"}
      aria-hidden="true"
      focusable="false"
      xmlns="http://www.w3.org/2000/svg"
      {...rest}
    >
      {grain ? <CrayonGrain /> : null}
      {grain ? <g mask="url(#yj-crayon-grain)">{children}</g> : children}
    </svg>
  );
}
/** 살짝 물결진 굵은 선. wide=머리글 아래, short=활성 탭 아래(그려지는 모션). */
export function CrayonUnderline({ variant }: { variant: "wide" | "short" }) {
  return variant === "wide" ? (
    <Svg grain className="decor-header" viewBox="0 0 320 12" preserveAspectRatio="none">
      <path
        className="d-line"
        vectorEffect="non-scaling-stroke"
        strokeWidth="4"
        d="M3 7 C26 3 49 10 82 6 C112 3 139 8 170 5 C203 2 232 9 262 6 C285 4 303 7 317 5"
      />
    </Svg>
  ) : (
    <Svg grain className="decor-tab" viewBox="0 0 40 8">
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
    <Svg grain viewBox="0 0 64 64">
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
    <Svg grain viewBox="0 0 96 56">
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
    <Svg grain viewBox="0 0 72 72">
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

/** 크레용 한 자루: 원통 + 종이 띠 + 뭉툭하게 닳은 원뿔 끝 */
export function CrayonStick() {
  return (
    <Svg grain viewBox="0 0 120 40">
      <path className="d-ink d-f1" d="M20 12 L85 10 L86.5 31 L21 31.5 C15 28 15 15 20 12 Z" />
      <path
        className="d-ink d-f1"
        d="M85.5 10.5 L103 15 C108.5 16.5 109 23.5 103.5 25.5 L86 30.5 Z"
      />
      <path className="d-ink d-paper" d="M38 11.5 L60 11 L61 30.5 L39 31 Z" />
      <path className="d-line" strokeWidth="1.6" d="M43 17 L56 16.6 M43.4 23 L56.4 22.6" />
      <path className="d-line" strokeWidth="2" d="M101 17 L105 19.5 M100 22 L104 22.8" />
    </Svg>
  );
}
/** 집: 삼각 지붕 + 네모 + 창 2개 + 문 */
export function DoodleHouse() {
  return (
    <Svg grain viewBox="0 0 96 80">
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
    <Svg grain viewBox="0 0 80 80">
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
    <Svg grain viewBox="0 0 88 72">
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
    <Svg grain viewBox="0 0 96 40">
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

/** 땅: 길게 흔들린 선 한 줄 + 풀 세 포기(PIN 화면 아래, 가운데 360px 만 보여도 되게 넓게 그림) */
export function DoodleGround() {
  return (
    <Svg grain viewBox="0 0 720 56" preserveAspectRatio="xMidYMax slice">
      <path
        className="d-line"
        strokeWidth="3"
        d="M0 46 C60 42 120 49 190 45 S320 48 380 44 S520 49 600 45 S690 47 720 44"
      />
      <path
        className="d-line"
        strokeWidth="2.6"
        d="M214 45 C212 36 210 30 206 25 M214 45 C215 35 217 29 220 23 M214 45 C218 39 223 35 228 33"
      />
      <path
        className="d-line"
        strokeWidth="2.6"
        d="M300 44 C298 37 297 32 293 28 M300 44 C302 36 304 31 307 27"
      />
      <path
        className="d-line"
        strokeWidth="2.6"
        d="M462 45 C460 37 458 31 454 26 M462 45 C463 36 466 30 469 25 M462 45 C466 40 471 37 476 35"
      />
    </Svg>
  );
}
