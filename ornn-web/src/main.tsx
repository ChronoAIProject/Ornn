import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/neon.css";
import "./stores/themeStore"; // Apply saved theme immediately
import "./i18n"; // Initialize i18next

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
