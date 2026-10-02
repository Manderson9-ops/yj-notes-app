import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { initLargeText } from "./lib/largeText";
import { createQueryClient } from "./lib/queryClient";
import { initTheme } from "./lib/theme";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/themes/crayon.css";
import "./styles/themes/forest.css";

const container = document.getElementById("root");
if (!container) {
  throw new Error("root element not found");
}

initLargeText();
initTheme();
const queryClient = createQueryClient();

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
