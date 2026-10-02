import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ThemePicker } from "../components/ThemePicker";
import { api } from "../lib/api";
import { useLargeText } from "../lib/largeText";
import { handleUnauthorized } from "../lib/queryClient";

export function SettingsPage() {
  const qc = useQueryClient();
  const [large, setLarge] = useLargeText();
  const logout = useMutation({
    mutationFn: () => api("DELETE", "/session"),
    onSettled: () => {
      handleUnauthorized(qc);
    },
  });

  return (
    <>
      <h1>설정</h1>
      <section className="settings-section">
        <label className="setting-row">
          <input
            type="checkbox"
            role="switch"
            checked={large}
            onChange={(e) => {
              setLarge(e.target.checked);
            }}
          />
          <span>큰 글씨</span>
        </label>
      </section>
      <section className="settings-section" aria-labelledby="set-theme">
        <h2 id="set-theme">화면 테마</h2>
        <ThemePicker />
        <p>
          <Link className="link" to="/settings/design">
            디자인 미리보기
          </Link>
        </p>
      </section>
      <section className="settings-section">
        <button
          type="button"
          className="btn"
          disabled={logout.isPending}
          onClick={() => {
            logout.mutate();
          }}
        >
          이 기기 로그아웃
        </button>
      </section>
      <p className="app-version">앱 버전 {__APP_VERSION__}</p>
    </>
  );
}
