import { BrowserRouter, Route, Routes } from "react-router-dom";
import { HomePage } from "../pages/HomePage";

export function App({ router = true }: { router?: boolean }) {
  const routes = (
    <Routes>
      <Route path="*" element={<HomePage />} />
    </Routes>
  );
  return router ? <BrowserRouter>{routes}</BrowserRouter> : routes;
}
