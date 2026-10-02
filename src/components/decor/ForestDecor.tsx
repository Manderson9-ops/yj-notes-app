import { Svg } from "./CrayonDecor";

// 숲 테마 장식 (docs/design/theme-forest.md §3). 전부 직접 그린 오리지널 path.
// 정령·동물·사람·탈것·특정 건물·장면 구도 없음. 둥근 적운, 겹친 언덕, 잎.

/** 언덕 3겹: 뒤로 갈수록 연하고(공기 원근), 맨 앞이 가장 어둡다(라이트·다크 모두).
 *  채움에 정적 feTurbulence 농담(수채 번짐 같은 결)을 곱하고, 각 언덕 윗가장자리에 옅은 빛줄기를 얹는다. */
export function HillLayers() {
  return (
    <Svg viewBox="0 0 360 96" preserveAspectRatio="none">
      <defs>
        <filter id="yj-hill-tone" filterUnits="userSpaceOnUse" x="0" y="0" width="360" height="96">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.018 0.06"
            numOctaves="3"
            seed="7"
            result="n"
          />
          <feColorMatrix
            in="n"
            type="matrix"
            values="0.3 0 0 0 0.72  0 0.3 0 0 0.72  0 0 0.3 0 0.72  0 0 0 0 1"
            result="tone"
          />
          <feBlend in="SourceGraphic" in2="tone" mode="multiply" result="m" />
          <feComposite in="m" in2="SourceGraphic" operator="in" />
        </filter>
      </defs>
      {/* 농담(multiply)은 불투명 채움에만 걸고, 뒤 언덕의 옅기(opacity)는 바깥 그룹이 맡는다 */}
      <g className="d-soft">
        <path
          className="d-f1"
          filter="url(#yj-hill-tone)"
          d="M0 52 C34 30 78 26 126 38 C176 51 226 62 276 40 C312 25 340 28 360 36 L360 96 L0 96 Z"
        />
      </g>
      <path
        className="d-f2"
        filter="url(#yj-hill-tone)"
        d="M0 70 C40 52 92 54 148 66 C206 78 262 74 306 60 C330 53 348 54 360 58 L360 96 L0 96 Z"
      />
      <path
        className="d-hill-front"
        filter="url(#yj-hill-tone)"
        d="M0 86 C60 78 120 84 200 88 C260 90 320 82 360 84 L360 96 L0 96 Z"
      />{" "}
      <g className="d-ridge">
        <path
          vectorEffect="non-scaling-stroke"
          d="M0 52 C34 30 78 26 126 38 C176 51 226 62 276 40 C312 25 340 28 360 36"
        />
        <path
          vectorEffect="non-scaling-stroke"
          d="M0 70 C40 52 92 54 148 66 C206 78 262 74 306 60 C330 53 348 54 360 58"
        />
        <path
          vectorEffect="non-scaling-stroke"
          d="M0 86 C60 78 120 84 200 88 C260 90 320 82 360 84"
        />
      </g>
    </Svg>
  );
}

/** 적운: 둥근 덩어리 6개를 위로 쌓아 크게 + 몸통 안으로 clip 한 아래쪽 푸른 음영(바깥 테두리 없음) */
export function CumulusCloud() {
  const body =
    "M14 70 A14 14 0 0 1 18 44 A17 17 0 0 1 44 36 A20 20 0 0 1 66 22 A22 22 0 0 1 100 20 A18 18 0 0 1 122 40 A15 15 0 0 1 128 70 C124 82 20 82 14 70 Z";
  return (
    <Svg viewBox="0 0 140 84">
      <defs>
        <clipPath id="yj-cumulus-clip">
          <path d={body} />
        </clipPath>
      </defs>
      <path className="d-cloud" d={body} />
      <g clipPath="url(#yj-cumulus-clip)">
        <path
          className="d-f1 d-shade"
          d="M0 69 C26 63 52 71 80 66 C104 62 124 64 140 67 L140 84 L0 84 Z"
        />
      </g>
    </Svg>
  );
}
/** 잎 한 장 + 잎맥 한 줄. 화면당 하나만 천천히 흔들린다. */
export function Leaf() {
  return (
    <Svg className="decor-sway" viewBox="0 0 64 72">
      <path className="d-f2" d="M32 68 C10 52 8 24 32 4 C56 24 54 52 32 68 Z" />
      <path className="d-line" strokeWidth="2" d="M32 64 L32 16" />
    </Svg>
  );
}

/** 새싹: 줄기 + 잎 두 장 */
export function Sprout() {
  return (
    <Svg viewBox="0 0 80 80">
      <path className="d-stem" strokeWidth="3" d="M40 76 C40 58 38 46 40 30" />
      <path className="d-f2" d="M40 42 C24 42 12 32 12 18 C28 16 40 26 40 42 Z" />
      <path className="d-f3" d="M40 34 C54 34 66 26 68 12 C52 10 41 20 40 34 Z" />
    </Svg>
  );
}

/** 바람결: 끝이 가늘어지는 길이 다른 세 줄(옅게) */
export function WindLines() {
  return (
    <Svg viewBox="0 0 120 40">
      <path
        className="d-f1 d-soft"
        d="M4 11 C30 3 52 17 80 9 C96 5 104 8 110 12 C98 9 90 11 78 13 C52 19 30 9 4 11 Z"
      />
      <path className="d-f1 d-soft" d="M18 24 C40 17 60 29 86 22 C70 28 44 27 18 24 Z" />
      <path className="d-f1 d-soft" d="M34 35 C48 31 62 37 78 33 C64 38 48 37 34 35 Z" />
    </Svg>
  );
}

/** 초승달 + 작은 별 세 개(밤에만 보임) */
export function MoonStars() {
  return (
    <Svg viewBox="0 0 100 60">
      <path className="d-f3" d="M36 5 A25 25 0 1 0 54 49 A30 30 0 0 1 36 5 Z" />
      <path
        className="d-f3"
        d="M72 8 L74 13 L79 14.5 L74 16 L72 21 L70 16 L65 14.5 L70 13 Z M88 30 L89.2 33 L92 34 L89.2 35 L88 38 L86.8 35 L84 34 L86.8 33 Z M68 42 L69.2 45 L72 46 L69.2 47 L68 50 L66.8 47 L64 46 L66.8 45 Z"
      />
    </Svg>
  );
}

/** 낮엔 구름, 밤(다크)엔 달과 별 */
export function SkyPair() {
  return (
    <span className="decor-sky" aria-hidden="true">
      <span className="decor-day">
        <CumulusCloud />
      </span>
      <span className="decor-night">
        <MoonStars />
      </span>
    </span>
  );
}
