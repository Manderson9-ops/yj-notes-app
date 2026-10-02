import { useTheme } from "../../lib/theme";
import {
  CrayonStick,
  CrayonUnderline,
  DoodleCloud,
  DoodleHouse,
  DoodleStar,
  DoodleSun,
} from "./CrayonDecor";
import { CumulusCloud, HillLayers, Leaf, MoonStars, Sprout, WindLines } from "./ForestDecor";

export type DecorSlot = "header" | "pin" | "empty" | "tab";

/**
 * 현재 테마에 맞는 장식 SVG 를 고른다. 테마 id 를 아는 곳은 이 컴포넌트와 lib/theme.ts 뿐이다(TH-8).
 * 장식은 모두 aria-hidden 이고, data-tone="serious" 영역 안에서는 CSS 가 숨긴다.
 */
export function ThemeDecor({ slot }: { slot: DecorSlot }) {
  const [theme] = useTheme();
  if (theme === "crayon") {
    switch (slot) {
      case "header":
        return <CrayonUnderline variant="wide" />;
      case "tab":
        return <CrayonUnderline variant="short" />;
      case "pin":
        return (
          <div className="decor-pin-top" aria-hidden="true">
            <DoodleStar />
            <DoodleSun />
            <DoodleCloud />
          </div>
        );
      case "empty":
        return (
          <div className="decor-empty" aria-hidden="true">
            <DoodleHouse />
            <DoodleCloud />
            <CrayonStick />
          </div>
        );
    }
  }
  if (theme === "forest") {
    switch (slot) {
      case "header":
        return (
          <span className="decor-header" aria-hidden="true">
            <CumulusCloud />
          </span>
        );
      case "tab":
        return null;
      case "pin":
        return (
          <>
            <div className="decor-pin-top" aria-hidden="true">
              <span className="decor-day">
                <CumulusCloud />
              </span>
              <span className="decor-night">
                <MoonStars />
              </span>
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
            <CumulusCloud />
            <Leaf />
            <Sprout />
          </div>
        );
    }
  }
  return null;
}
