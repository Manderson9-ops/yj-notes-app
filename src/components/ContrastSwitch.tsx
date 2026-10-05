import { SettingSwitch } from "./SettingSwitch";
import { useContrast } from "../lib/highContrast";

/** 선명하게 보기 스위치. 켜면 글자·테두리 대비를 최대로 올리고 장식을 끈다. */
export function ContrastSwitch() {
  const [high, setHigh] = useContrast();
  return (
    <SettingSwitch
      label="선명하게 보기"
      help="글자와 테두리를 더 진하게"
      checked={high}
      onChange={setHigh}
    />
  );
}
