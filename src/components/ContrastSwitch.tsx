import { useContrast } from "../lib/highContrast";

/** 선명하게 보기 스위치(S90·S91 공용). 켜면 글자·테두리 대비를 최대로 올리고 장식을 끈다. */
export function ContrastSwitch() {
  const [high, setHigh] = useContrast();
  return (
    <label className="setting-row">
      <input
        type="checkbox"
        role="switch"
        checked={high}
        onChange={(e) => {
          setHigh(e.target.checked);
        }}
      />
      <span>선명하게 보기</span>
    </label>
  );
}
