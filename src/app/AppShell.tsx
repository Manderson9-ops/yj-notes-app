import { NavLink, Outlet } from "react-router-dom";
import { HomeIcon, LibraryIcon, LogIcon, NoteIcon, SettingsIcon } from "../components/icons";
import { ThemeDecor } from "../components/decor/ThemeDecor";
import { OfflineBanner } from "../components/OfflineBanner";

const TABS = [
  { to: "/", label: "홈", icon: <HomeIcon />, end: true },
  { to: "/logs", label: "기록", icon: <LogIcon />, end: false },
  { to: "/notes", label: "알림장", icon: <NoteIcon />, end: false },
  { to: "/library", label: "자료", icon: <LibraryIcon />, end: false },
];

export function AppShell() {
  return (
    <div className="shell">
      <OfflineBanner />
      <header className="shell-header">
        <p className="app-title">가족 기록</p>
        <ThemeDecor slot="header" />
        <NavLink to="/settings" className="icon-btn" aria-label="설정">
          <SettingsIcon />
        </NavLink>
      </header>
      <main className="shell-main">
        <Outlet />
      </main>
      <nav className="tabbar" aria-label="주요 메뉴">
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end} className="tab">
            {t.icon}
            <span>{t.label}</span>
            <ThemeDecor slot="tab" />
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
