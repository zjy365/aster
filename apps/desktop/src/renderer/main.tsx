import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { TooltipProvider } from "@/components/ui/tooltip";
import App from "./App";
import { applyStoredTheme } from "./hooks/useTheme";
import "./styles.css";

// Apply the stored scheme + palette synchronously so the first painted frame
// already carries the user's theme (the index.html boot script only covers
// the window background).
applyStoredTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TooltipProvider delay={500} timeout={250}>
      <App />
    </TooltipProvider>
  </StrictMode>,
);
