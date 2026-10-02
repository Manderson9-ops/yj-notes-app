import { lazy, Suspense, type ReactNode } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { useSession } from "../lib/session";
import { DesignPreview } from "../pages/DesignPreview";
import { Placeholder } from "../pages/Placeholder";
import { PinScreen } from "../pages/PinScreen";
import { SettingsPage } from "../pages/SettingsPage";
import { AppShell } from "./AppShell";

// 자료 화면(S40~S43)은 처음 열 때만 내려받는다(초기 번들 예산, docs/08 Q-PERF).
const LibraryPage = lazy(() => import("../features/library/LibraryPage"));
const DocPage = lazy(() => import("../features/library/DocPage"));
const CheckupsPage = lazy(() => import("../features/library/CheckupsPage"));
const GrowthPage = lazy(() => import("../features/library/GrowthPage"));

function Lazy({ children }: { children: ReactNode }) {
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
  if (session.isError || !session.data.authenticated) {
    return <PinScreen />;
  }
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Placeholder title="홈" variant="home" />} />
        <Route path="logs" element={<Placeholder title="기록" variant="logs" />} />
        <Route path="notes" element={<Placeholder title="알림장" variant="notes" />} />
        <Route
          path="library"
          element={
            <Lazy>
              <LibraryPage />
            </Lazy>
          }
        />
        <Route
          path="library/doc/:slug"
          element={
            <Lazy>
              <DocPage />
            </Lazy>
          }
        />
        <Route
          path="library/checkups"
          element={
            <Lazy>
              <CheckupsPage />
            </Lazy>
          }
        />
        <Route
          path="library/growth"
          element={
            <Lazy>
              <GrowthPage />
            </Lazy>
          }
        />
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
