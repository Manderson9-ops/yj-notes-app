import { SettingSwitch } from "./SettingSwitch";
import { useLargeText } from "../lib/largeText";

/** 큰 글씨 스위치. */
export function LargeTextSwitch() {
  const [large, setLarge] = useLargeText();
  return <SettingSwitch label="큰 글씨" help="글자를 크게" checked={large} onChange={setLarge} />;
}
