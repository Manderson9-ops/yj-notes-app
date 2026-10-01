export function HomePage() {
  return (
    <div className="shell">
      <header className="shell-header">
        <p className="app-title">가족 기록</p>
      </header>
      <main className="shell-main">
        <h1>기록</h1>
      </main>
      <footer className="shell-footer">버전 {__APP_VERSION__}</footer>
    </div>
  );
}
