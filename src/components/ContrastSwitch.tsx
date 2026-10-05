import { useId } from "react";
import { useContrast } from "../lib/highContrast";

/** 선명하게 보기 스위치(S90·S91 공용). 켜면 글자·테두리 대비를 최대로 올리고 장식을 끈다. 켜짐/꺼짐 글자를 함께 보인다. */
export function ContrastSwitch() {
  const [high, setHigh] = useContrast();
  const nameId = useId();
  const helpId = useId();
  return (
    <label className="theme-option switch-row">
      <input
        type="checkbox"
        role="switch"
        aria-checked={high}
        aria-labelledby={nameId}
        aria-describedby={helpId}
        checked={high}
        onChange={(e) => {
          setHigh(e.target.checked);
        }}
      />
      <span className="theme-name">
        <span id={nameId}>선명하게 보기</span>
        <span id={helpId} className="switch-help">
          글자와 테두리를 더 진하게
        </span>
      </span>
      <span className="switch-state" aria-hidden="true">
        {high ? "켜짐" : "꺼짐"}
      </span>
      <span className="switch-track" aria-hidden="true">
        <i />
      </span>
    </label>
  );
}
