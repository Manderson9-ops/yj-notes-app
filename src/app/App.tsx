import { BrowserRouter, Route, Routes } from "react-router-dom";
import { useSession } from "../lib/session";
import { Placeholder } from "../pages/Placeholder";
import { PinScreen } from "../pages/PinScreen";
import { SettingsPage } from "../pages/SettingsPage";
import { AppShell } from "./AppShell";

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
        <Route index element={<Placeholder title="홈" />} />
        <Route path="logs" element={<Placeholder title="기록" />} />
        <Route path="notes" element={<Placeholder title="알림장" />} />
        <Route path="library" element={<Placeholder title="자료" />} />
        <Route path="settings" element={<SettingsPage />} />
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
