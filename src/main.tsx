import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { initContrast } from "./lib/highContrast";
import { initLargeText } from "./lib/largeText";
import { createQueryClient } from "./lib/queryClient";
import { initScheme } from "./lib/scheme";
import { initTheme } from "./lib/theme";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/themes/crayon.css";
import "./styles/themes/forest.css";
import "./styles/contrast-high.css";

const container = document.getElementById("root");
if (!container) {
  throw new Error("root element not found");
}

initLargeText();
initTheme();
initScheme();
initContrast();

// 앱 껍데기만 캐시하는 서비스 워커(public/sw.js). 데이터(/api)는 캐시하지 않는다. 개발 서버에서는 켜지 않는다.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
}
const queryClient = createQueryClient();

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
