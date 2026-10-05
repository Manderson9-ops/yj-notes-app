import { useId } from "react";

/** 스위치 한 줄(S90·S91 공용: 큰 글씨·선명하게 보기). 이름·도움말·켜짐/꺼짐 글자·트랙/손잡이를 함께 보인다. */
export function SettingSwitch({
  label,
  help,
  checked,
  onChange,
}: {
  label: string;
  help: string;
  checked: boolean;
  onChange: (on: boolean) => void;
}) {
  const nameId = useId();
  const helpId = useId();
  return (
    <label className="theme-option switch-row">
      <input
        type="checkbox"
        role="switch"
        aria-checked={checked}
        aria-labelledby={nameId}
        aria-describedby={helpId}
        checked={checked}
        onChange={(e) => {
          onChange(e.target.checked);
        }}
      />
      <span className="theme-name">
        <span id={nameId}>{label}</span>
        <span id={helpId} className="switch-help">
          {help}
        </span>
      </span>
      <span className="switch-ctl" aria-hidden="true">
        <span className="switch-track">
          <i />
        </span>
        <span className="switch-state">{checked ? "켜짐" : "꺼짐"}</span>
      </span>
    </label>
  );
}
