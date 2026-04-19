import { useEffect } from "react";
import { HashRouter, Route, Routes } from "react-router-dom";
import Index from "./pages/Index.tsx";
import NotFound from "./pages/NotFound.tsx";
import Heart from "./pages/Heart.tsx";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { closeWindow } from "./lib/tauriWindow";

const App = () => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Global quit shortcut: Ctrl/Cmd+Q. Required because the window is frameless
      // and has no native title bar to fall back on if the React UI fails.
      const isQuit = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "q";
      if (isQuit) {
        e.preventDefault();
        void closeWindow();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <ErrorBoundary>
      <HashRouter>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/heart" element={<Heart />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </HashRouter>
    </ErrorBoundary>
  );
};

export default App;
