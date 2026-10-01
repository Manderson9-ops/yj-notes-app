import { useMutation, useQueryClient } from "@tanstack/react-query";
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
