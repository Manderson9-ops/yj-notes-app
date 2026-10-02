import { Svg } from "./CrayonDecor";

// 숲 테마 장식 (docs/design/theme-forest.md §3). 전부 직접 그린 오리지널 path.
// 정령·동물·사람·탈것·특정 건물·장면 구도 없음. 둥근 적운, 겹친 언덕, 잎.

/** 언덕 2겹: 뒤 언덕은 연하게(공기 원근) */
export function HillLayers() {
  return (
    <Svg viewBox="0 0 360 96" preserveAspectRatio="none">
      <path
        className="d-f1 d-soft"
        d="M0 52 C34 30 78 26 126 38 C176 51 226 62 276 40 C312 25 340 28 360 36 L360 96 L0 96 Z"
      />
      <path
        className="d-f2"
        d="M0 70 C40 52 92 54 148 66 C206 78 262 74 306 60 C330 53 348 54 360 58 L360 96 L0 96 Z"
      />
      <path
        className="d-f3 d-soft"
        d="M0 86 C60 78 120 84 200 88 C260 90 320 82 360 84 L360 96 L0 96 Z"
      />
    </Svg>
  );
}

/** 적운: 둥근 덩어리 4개 + 아래쪽 연한 푸른 음영 */
export function CumulusCloud() {
  return (
    <Svg viewBox="0 0 120 60">
      <path
        className="d-paper"
        d="M20 50 A14 14 0 0 1 22 22 A18 18 0 0 1 56 14 A16 16 0 0 1 86 24 A14 14 0 0 1 100 50 Z"
      />
      <path
        className="d-f1 d-shade"
        d="M22 50 C28 42 40 44 52 43 C66 42 78 40 88 44 C95 46 98 48 100 50 Z"
      />
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
      <path className="d-line" strokeWidth="3" d="M40 76 C40 58 38 46 40 30" />
      <path className="d-f2" d="M40 42 C24 42 12 32 12 18 C28 16 40 26 40 42 Z" />
      <path className="d-f3" d="M40 34 C54 34 66 26 68 12 C52 10 41 20 40 34 Z" />
    </Svg>
  );
}

/** 바람결: 끝이 둥근 곡선 세 줄 */
export function WindLines() {
  return (
    <Svg viewBox="0 0 120 40">
      <path
        className="d-st1"
        strokeWidth="3"
        d="M4 10 C30 4 50 16 76 9 C88 6 96 8 100 12 M16 22 C40 16 60 28 88 21 M30 33 C50 29 62 36 82 32"
      />
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
