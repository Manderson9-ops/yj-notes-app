import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { QueueSync } from "../components/QueueSync";
import { ApiError } from "../lib/api";
import { useSession } from "../lib/session";
import { DesignPreview } from "../pages/DesignPreview";
import { Placeholder } from "../pages/Placeholder";
import { PinScreen } from "../pages/PinScreen";
import { SettingsPage } from "../pages/SettingsPage";
import { AppShell } from "./AppShell";

// 화면은 필요할 때 내려받는다(첫 화면 크기를 지킨다).
const LogsPage = lazy(() => import("../pages/LogsPage").then((m) => ({ default: m.LogsPage })));
const loadLogEditor = () => import("../pages/LogEditorPage");
const LogEditorPage = lazy(() => loadLogEditor().then((m) => ({ default: m.LogEditorPage })));

const SESSION_HINT = "yj.sessionHint";

function readHint(): boolean {
  try {
    return localStorage.getItem(SESSION_HINT) === "1";
  } catch {
    return false;
  }
}

function Loading() {
  return (
    <p className="loading" role="status">
      불러오는 중
    </p>
  );
}

function AuthGate() {
  const session = useSession();
  const authed = session.data?.authenticated;
  const failedAt = session.errorUpdatedAt;
  const { refetch } = session;
  // 마지막으로 로그인돼 있던 기기는 연결이 끊겨도 앱을 열어 기록을 받아 둔다(F2-6). 서버 확인은 연결 복구 때 다시 한다.
  useEffect(() => {
    try {
      if (authed === true) localStorage.setItem(SESSION_HINT, "1");
      else if (authed === false) localStorage.removeItem(SESSION_HINT);
    } catch {
      /* 저장소를 못 쓰면 힌트 없이 동작 */
    }
  }, [authed]);
  useEffect(() => {
    if (failedAt === 0) return;
    const retry = () => {
      void refetch();
    };
    window.addEventListener("online", retry);
    return () => {
      window.removeEventListener("online", retry);
    };
  }, [failedAt, refetch]);
  // 입력 화면 조각은 로그인 직후 미리 받아 둔다: 나중에 연결이 끊겨도 기록 입력이 열리게(서비스 워커가 이 조각을 캐시한다).
  useEffect(() => {
    if (authed !== true) return;
    const id = window.setTimeout(() => {
      void loadLogEditor();
    }, 1500);
    return () => {
      window.clearTimeout(id);
    };
  }, [authed]);
  const offlineKnown =
    session.isError &&
    session.error instanceof ApiError &&
    session.error.status === 0 &&
    readHint();
  if (session.isPending) {
    return (
      <p className="loading" role="status">
        불러오는 중
      </p>
    );
  }
  if (!offlineKnown && (session.isError || !session.data.authenticated)) {
    return <PinScreen />;
  }
  return (
    <>
      <QueueSync />
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<Placeholder title="홈" variant="home" />} />
            <Route path="logs" element={<LogsPage />} />
            <Route path="logs/new" element={<LogEditorPage />} />
            <Route path="logs/:id/edit" element={<LogEditorPage />} />
            <Route path="notes" element={<Placeholder title="알림장" variant="notes" />} />
            <Route path="library" element={<Placeholder title="자료" variant="library" />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="settings/design" element={<DesignPreview />} />
            <Route path="*" element={<Placeholder title="홈" />} />
          </Route>
        </Routes>
      </Suspense>
    </>
  );
}

export function App({ router = true }: { router?: boolean }) {
  return router ? (
    <BrowserRouter>
      <AuthGate />
    </BrowserRouter>
  ) : (
    <AuthGate />
  );
}
