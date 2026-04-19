import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { MilestoneHeartOverlay } from "@/components/MilestoneHeartOverlay";
import { HEART_CLEAR_EVENT, HEART_EVENT, type HeartPayload } from "@/lib/tauriWindow";

/**
 * Standalone route rendered inside the dedicated `heart` Tauri window.
 * Listens for `heart:update` events emitted by the main window and
 * displays the milestone heart animation on a fully transparent surface.
 */
const Heart = () => {
  const [payload, setPayload] = useState<HeartPayload | null>(null);

  useEffect(() => {
    // Make absolutely sure the document/body are transparent — this window
    // is meant to be click-through with only the heart graphic visible.
    const prevHtmlBg = document.documentElement.style.background;
    const prevBodyBg = document.body.style.background;
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";

    const unlisteners: Array<() => void> = [];
    void listen<HeartPayload>(HEART_EVENT, (event) => {
      setPayload(event.payload);
    }).then((fn) => {
      unlisteners.push(fn);
    });
    void listen(HEART_CLEAR_EVENT, () => {
      setPayload(null);
    }).then((fn) => {
      unlisteners.push(fn);
    });

    // Clear payload if the window becomes hidden so the next show() starts
    // blank and never briefly displays the previous milestone's heart.
    const onVisibility = () => {
      if (document.hidden) setPayload(null);
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      unlisteners.forEach((fn) => fn());
      document.removeEventListener("visibilitychange", onVisibility);
      document.documentElement.style.background = prevHtmlBg;
      document.body.style.background = prevBodyBg;
    };
  }, []);

  if (!payload) {
    return <div className="h-screen w-screen" style={{ background: "transparent" }} />;
  }

  return (
    <div
      className="flex h-screen w-screen items-center justify-center"
      style={{ background: "transparent", pointerEvents: "none" }}
    >
      <MilestoneHeartOverlay
        key={payload.key}
        overlayKey={payload.key}
        phase={payload.phase}
        remainingLabel={payload.remainingLabel}
      />
    </div>
  );
};

export default Heart;
