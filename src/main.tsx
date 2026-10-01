import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { initLargeText } from "./lib/largeText";
import { createQueryClient } from "./lib/queryClient";
import "./styles/tokens.css";
import "./styles/base.css";

const container = document.getElementById("root");
if (!container) {
  throw new Error("root element not found");
}

initLargeText();
const queryClient = createQueryClient();

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
