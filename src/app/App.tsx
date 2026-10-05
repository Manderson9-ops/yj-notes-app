import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { ApiError } from "../lib/api";
import { useSession } from "../lib/session";
import { Placeholder } from "../pages/Placeholder";
import { PinScreen } from "../pages/PinScreen";
import { AppShell } from "./AppShell";
import { QueueSyncGate } from "./QueueSyncGate";

// 화면은 필요할 때 내려받는다(첫 화면 크기를 지킨다. 초기 번들 예산: docs/08 Q-PERF).
const SettingsPage = lazy(() =>
  import("../pages/SettingsPage").then((m) => ({ default: m.SettingsPage })),
);
const DesignPreview = lazy(() =>
  import("../pages/DesignPreview").then((m) => ({ default: m.DesignPreview })),
);
const HomePage = lazy(() => import("../pages/HomePage"));
const NotesPage = lazy(() => import("../pages/NotesPage"));
const NoteDetailPage = lazy(() => import("../pages/NoteDetailPage"));
const LibraryPage = lazy(() => import("../features/library/LibraryPage"));
const DocPage = lazy(() => import("../features/library/DocPage"));
const CheckupsPage = lazy(() => import("../features/library/CheckupsPage"));
const GrowthPage = lazy(() => import("../features/library/GrowthPage"));
const AskPage = lazy(() => import("../pages/AskPage"));
const AskDetailPage = lazy(() => import("../pages/AskDetailPage"));
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
      // 연결이 끊기기 전에 받아 둔다(서비스 워커가 캐시): 오프라인 배너의 건수 부분.
      void import("../components/QueueBanners");
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
  if (session.isPending) return <Loading />;
  if (!offlineKnown) {
    if (session.isError) return <PinScreen />;
    if (!session.data.authenticated) return <PinScreen pinLength={session.data.pinLength} />;
  }
  return (
    <>
      <QueueSyncGate />
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<HomePage />} />
            <Route path="logs" element={<LogsPage />} />
            <Route path="logs/new" element={<LogEditorPage />} />
            <Route path="logs/:id/edit" element={<LogEditorPage />} />
            <Route path="ask" element={<AskPage />} />
            <Route path="ask/:id" element={<AskDetailPage />} />
            <Route path="notes" element={<NotesPage />} />
            <Route path="notes/:date" element={<NoteDetailPage />} />
            <Route path="library" element={<LibraryPage />} />
            <Route path="library/doc/:slug" element={<DocPage />} />
            <Route path="library/checkups" element={<CheckupsPage />} />
            <Route path="library/growth" element={<GrowthPage />} />
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
