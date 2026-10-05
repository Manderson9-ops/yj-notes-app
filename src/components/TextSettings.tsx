import { ContrastSwitch } from "./ContrastSwitch";
import { LargeTextSwitch } from "./LargeTextSwitch";

/** 「글자·선명도」 묶음(S90·S91 공용): 큰 글씨 + 선명하게 보기. */
export function TextSettings() {
  return (
    <div className="theme-group">
      <LargeTextSwitch />
      <ContrastSwitch />
    </div>
  );
}
