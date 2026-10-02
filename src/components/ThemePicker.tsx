import { THEMES, useTheme } from "../lib/theme";

/** 화면 테마 고르기(S90·S91 공용). 고르면 바로 적용되고 이 기기에 저장된다. */
export function ThemePicker() {
  const [theme, setTheme] = useTheme();
  return (
    <div className="theme-group" role="radiogroup" aria-label="화면 테마">
      {THEMES.map((t) => (
        <label key={t.id} className="theme-option">
          <input
            type="radio"
            name="theme"
            value={t.id}
            checked={theme === t.id}
            onChange={() => {
              setTheme(t.id);
            }}
          />
          <span className="theme-name">{t.label}</span>
          <span className="swatch" data-swatch={t.id} aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        </label>
      ))}
    </div>
  );
}
