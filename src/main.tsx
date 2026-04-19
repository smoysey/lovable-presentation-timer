import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import "./App.css";

if (import.meta.env.DEV) {
  // Dev-only window probe — never ships to production bundles.
  void import("./lib/windowProbe").then(({ installWindowProbe }) => installWindowProbe());
}

createRoot(document.getElementById("root")!).render(<App />);
