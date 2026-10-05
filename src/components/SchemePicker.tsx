import { SCHEMES, useScheme } from "../lib/scheme";

/** 화면 밝기 고르기(S90·S91 공용). 「시스템에 맞춤」이 기본이고, 고르면 바로 적용돼 이 기기에 저장된다. */
export function SchemePicker() {
  const [scheme, setScheme] = useScheme();
  return (
    <div className="theme-group" role="radiogroup" aria-label="화면 밝기">
      {SCHEMES.map((s) => (
        <label key={s.id} className="theme-option">
          <input
            type="radio"
            name="scheme"
            value={s.id}
            checked={scheme === s.id}
            onChange={() => {
              setScheme(s.id);
            }}
          />
          <span className="theme-name">{s.label}</span>
        </label>
      ))}
    </div>
  );
}
