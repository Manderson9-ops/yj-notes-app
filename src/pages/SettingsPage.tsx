import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { SchemePicker } from "../components/SchemePicker";
import { TextSettings } from "../components/TextSettings";
import { ThemePicker } from "../components/ThemePicker";
import { api } from "../lib/api";
import { formatYmdKo, seoulDateOf } from "../lib/dateFormat";
import { useOverview } from "../lib/notesApi";
import { clearQueue, unsentCounts } from "../lib/logs/queue";
import { handleUnauthorized } from "../lib/queryClient";

export function SettingsPage() {
  const qc = useQueryClient();
  const overview = useOverview();
  const lastLock = overview.data?.security.lastGlobalLockAt ?? null;
  const failures7d = overview.data?.security.failures7d ?? 0;
  const logout = useMutation({
    mutationFn: () => api("DELETE", "/session"),
    onSettled: () => {
      handleUnauthorized(qc);
    },
  });

  // 보내지 않은 기록이 이 기기에 있으면 로그아웃 전에 물어본다(남겨 두면 다시 로그인할 때 보낸다).
  const [unsent, setUnsent] = useState<{ pending: number; failed: number } | null>(null);
  const askLogout = async () => {
    const c = await unsentCounts();
    const total = c.pending + c.failed;
    if (total === 0) logout.mutate();
    else setUnsent({ pending: c.pending, failed: c.failed });
  };

  return (
    <>
      <h1>설정</h1>
      <section className="settings-section" aria-labelledby="set-theme">
        <h2 id="set-theme">화면 테마</h2>
        <ThemePicker />
      </section>
      <section className="settings-section" aria-labelledby="set-scheme">
        <h2 id="set-scheme">화면 밝기</h2>
        <SchemePicker />
      </section>
      <section className="settings-section" aria-labelledby="set-text">
        <h2 id="set-text">글자·선명도</h2>
        <TextSettings />
      </section>
      <section className="settings-section">
        <button
          type="button"
          className="btn"
          disabled={logout.isPending}
          onClick={() => {
            void askLogout();
          }}
        >
          이 기기 로그아웃
        </button>
      </section>
      {(lastLock !== null || failures7d > 0) && (
        <section className="settings-section" aria-labelledby="set-security">
          <h2 id="set-security">보안</h2>
          {lastLock !== null && (
            <p className="muted" data-testid="last-global-lock">
              최근 전체 잠금: {formatYmdKo(seoulDateOf(lastLock))}
            </p>
          )}
          <p className="muted" data-testid="pin-failures-7d">
            최근 7일 PIN 실패: {failures7d}회
          </p>
        </section>
      )}
      <section className="settings-section" aria-labelledby="set-more">
        <h2 id="set-more">더 보기</h2>
        <Link className="link" to="/settings/design">
          디자인 미리보기
        </Link>
      </section>
      <p className="app-version">앱 버전 {__APP_VERSION__}</p>
      <ConfirmDialog
        open={unsent !== null}
        title="보내지 않은 기록이 있어요"
        confirmLabel="지우고 로그아웃"
        secondaryLabel="남겨 두고 로그아웃"
        cancelLabel="취소"
        busy={logout.isPending}
        onCancel={() => {
          setUnsent(null);
        }}
        onSecondary={() => {
          setUnsent(null);
          logout.mutate();
        }}
        onConfirm={() => {
          void clearQueue().then(() => {
            setUnsent(null);
            logout.mutate();
          });
        }}
      >
        <p>
          이 기기에 보내지 않은 기록이 {String((unsent?.pending ?? 0) + (unsent?.failed ?? 0))}건
          있어요.
        </p>
        {(unsent?.pending ?? 0) > 0 && (
          <p>{String(unsent?.pending ?? 0)}건은 남겨 두면 다시 로그인할 때 보내요.</p>
        )}
        {(unsent?.failed ?? 0) > 0 && (
          <>
            <p>{String(unsent?.failed ?? 0)}건은 보내지 못했어요.</p>
            <p>남겨 두면 기록 화면에서 볼 수 있어요.</p>
          </>
        )}
        <p>지우면 되돌릴 수 없어요.</p>
      </ConfirmDialog>
    </>
  );
}
