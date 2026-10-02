import { useTheme } from "../../lib/theme";
import {
  CrayonStick,
  CrayonUnderline,
  DoodleBall,
  DoodleCloud,
  DoodleGround,
  DoodleHouse,
  DoodlePuddle,
  DoodleStar,
  DoodleSun,
  DoodleUmbrella,
} from "./CrayonDecor";
import {
  CumulusCloud,
  HillLayers,
  Leaf,
  MoonStars,
  SkyPair,
  Sprout,
  WindLines,
} from "./ForestDecor";

export type DecorSlot = "header" | "pin" | "empty" | "tab";
/** 빈 상태는 화면마다 조합이 조금씩 다르다(테마 분기는 여기서만). */
export type DecorVariant = "home" | "logs" | "notes" | "library";

function CrayonEmpty({ variant }: { variant: DecorVariant }) {
  switch (variant) {
    case "logs":
      return (
        <>
          <DoodleUmbrella />
          <DoodlePuddle />
          <DoodleStar />
        </>
      );
    case "notes":
      return (
        <>
          <DoodleBall />
          <DoodleCloud />
          <CrayonStick />
        </>
      );
    case "library":
      return (
        <>
          <DoodleHouse />
          <DoodleBall />
          <DoodlePuddle />
        </>
      );
    default:
      return (
        <>
          <DoodleHouse />
          <DoodleCloud />
          <CrayonStick />
        </>
      );
  }
}

/**
 * 현재 테마에 맞는 장식 SVG 를 고른다. 테마 id 를 아는 곳은 이 컴포넌트와 lib/theme.ts 뿐이다(TH-8).
 * 장식은 모두 aria-hidden 이고, data-tone="serious" 영역 안에서는 CSS 가 숨긴다.
 */
export function ThemeDecor({
  slot,
  variant = "home",
}: {
  slot: DecorSlot;
  variant?: DecorVariant;
}) {
  const [theme] = useTheme();
  if (theme === "crayon") {
    switch (slot) {
      case "header":
        return <CrayonUnderline variant="wide" />;
      case "tab":
        return <CrayonUnderline variant="short" />;
      case "pin":
        return (
          <>
            <div className="decor-pin-top" aria-hidden="true">
              <DoodleStar />
              <DoodleSun />
              <DoodleCloud />
            </div>
            <div className="decor-pin-bottom decor-pin-ground" aria-hidden="true">
              <DoodleGround />
            </div>
          </>
        );
      case "empty":
        return (
          <div className="decor-empty" aria-hidden="true">
            <CrayonEmpty variant={variant} />
          </div>
        );
    }
  }
  if (theme === "forest") {
    switch (slot) {
      case "header":
        return (
          <span className="decor-header" aria-hidden="true">
            <span className="decor-day">
              <CumulusCloud />
            </span>
            <span className="decor-night">
              <MoonStars />
            </span>
          </span>
        );
      case "tab":
        return null;
      case "pin":
        return (
          <>
            <div className="decor-pin-top" aria-hidden="true">
              <SkyPair />
              <WindLines />
            </div>
            <div className="decor-pin-bottom" aria-hidden="true">
              <HillLayers />
            </div>
          </>
        );
      case "empty":
        return (
          <div className="decor-empty decor-empty-forest" aria-hidden="true">
            <HillLayers />
            <SkyPair />
            {variant === "library" ? null : <Leaf />}
            {variant === "notes" ? null : <Sprout />}
          </div>
        );
    }
  }
  return null;
}
