import { lazy, Suspense } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { useSession } from "../lib/session";
import { DesignPreview } from "../pages/DesignPreview";
import { Placeholder } from "../pages/Placeholder";
import { PinScreen } from "../pages/PinScreen";
import { SettingsPage } from "../pages/SettingsPage";
import { AppShell } from "./AppShell";

// 홈·알림장은 처음 열 때 내려받는다(초기 번들 증가 최소화).
const HomePage = lazy(() => import("../pages/HomePage"));
const NotesPage = lazy(() => import("../pages/NotesPage"));
const NoteDetailPage = lazy(() => import("../pages/NoteDetailPage"));

function Lazy({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <p className="loading" role="status">
          불러오는 중
        </p>
      }
    >
      {children}
    </Suspense>
  );
}

function AuthGate() {
  const session = useSession();
  if (session.isPending) {
    return (
      <p className="loading" role="status">
        불러오는 중
      </p>
    );
  }
  if (session.isError) return <PinScreen />;
  if (!session.data.authenticated) return <PinScreen pinLength={session.data.pinLength} />;
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route
          index
          element={
            <Lazy>
              <HomePage />
            </Lazy>
          }
        />
        <Route path="logs" element={<Placeholder title="기록" variant="logs" />} />
        <Route
          path="notes"
          element={
            <Lazy>
              <NotesPage />
            </Lazy>
          }
        />
        <Route
          path="notes/:date"
          element={
            <Lazy>
              <NoteDetailPage />
            </Lazy>
          }
        />
        <Route path="library" element={<Placeholder title="자료" variant="library" />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="settings/design" element={<DesignPreview />} />
        <Route path="*" element={<Placeholder title="홈" />} />
      </Route>
    </Routes>
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
