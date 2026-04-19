// Typed wrappers around the Tauri v2 window API. All functions degrade
// gracefully in the browser preview where the Tauri runtime is absent.
import {
  currentMonitor,
  getCurrentWindow,
  LogicalSize,
  LogicalPosition,
  type Window as TauriWindow,
} from "@tauri-apps/api/window";
import { Window as TauriWindowCtor } from "@tauri-apps/api/window";
import { emit } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

const isTauriRuntime = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const safeWindow = (): TauriWindow | null => {
  if (!isTauriRuntime()) return null;
  try {
    return getCurrentWindow();
  } catch {
    return null;
  }
};

const safeWindowByLabel = async (label: string): Promise<TauriWindow | null> => {
  if (!isTauriRuntime()) return null;
  try {
    return await TauriWindowCtor.getByLabel(label);
  } catch {
    return null;
  }
};

export const isTauri = (): boolean => isTauriRuntime();

export const resizeWindow = async (width: number, height: number, center?: boolean) => {
  const w = safeWindow();
  if (!w) return;
  try {
    await w.setSize(new LogicalSize(width, height));
    if (center) await w.center();
  } catch {
    // window APIs may throw if capabilities deny; non-fatal
  }
};

export const getWindowPosition = async (): Promise<{ x: number; y: number } | null> => {
  const w = safeWindow();
  if (!w) return null;
  try {
    const scale = await w.scaleFactor();
    const pos = await w.outerPosition();
    return {
      x: Math.round(pos.x / scale),
      y: Math.round(pos.y / scale),
    };
  } catch {
    return null;
  }
};

export const restoreWindowPosition = async (pos: { x: number; y: number }) => {
  const w = safeWindow();
  if (!w) return;
  try {
    await w.setPosition(new LogicalPosition(pos.x, pos.y));
  } catch {
    // ignore
  }
};

export const startDragging = async () => {
  const w = safeWindow();
  if (!w) return;
  try {
    await w.startDragging();
  } catch {
    // ignore
  }
};

export const closeWindow = async () => {
  const w = safeWindow();
  if (!w) {
    window.close();
    return;
  }
  try {
    await w.close();
  } catch {
    window.close();
  }
};

export const setAlwaysOnTop = async (value: boolean) => {
  const w = safeWindow();
  if (!w) return;
  try {
    await w.setAlwaysOnTop(value);
  } catch {
    // ignore
  }
};

// ============================================================
// Heart overlay — strategy-dispatched
// ============================================================

export type HeartPayload = {
  phase: "grow" | "erase";
  remainingLabel: string;
  key: number;
};

export const HEART_EVENT = "heart:update";
export const HEART_CLEAR_EVENT = "heart:clear";
/** Emitted on the MAIN window when the inline (in-process) overlay should render. */
export const HEART_INLINE_EVENT = "heart:inline-show";
/** Emitted on the MAIN window when the inline overlay should clear. */
export const HEART_INLINE_HIDE_EVENT = "heart:inline-hide";

type HeartStrategy = "separate" | "inline" | "disabled";

const HEART_WINDOW_SIZE = 620;
let heartReplayTimers: ReturnType<typeof setTimeout>[] = [];

const clearHeartReplayTimers = () => {
  heartReplayTimers.forEach(clearTimeout);
  heartReplayTimers = [];
};

const getHeartWindowCenterPosition = async (): Promise<{ x: number; y: number } | null> => {
  if (!isTauriRuntime()) return null;
  try {
    const monitor = await currentMonitor();
    if (!monitor) return null;

    const scale = monitor.scaleFactor || 1;
    const workAreaWidth = monitor.workArea.size.width / scale;
    const workAreaHeight = monitor.workArea.size.height / scale;
    const workAreaX = monitor.workArea.position.x / scale;
    const workAreaY = monitor.workArea.position.y / scale;

    return {
      x: Math.round(workAreaX + (workAreaWidth - HEART_WINDOW_SIZE) / 2),
      y: Math.round(workAreaY + (workAreaHeight - HEART_WINDOW_SIZE) / 2),
    };
  } catch {
    return null;
  }
};

// Strategy is fetched once on first use and cached. The Rust side may have
// downgraded `separate` -> `inline` at startup based on the detected
// display server (Wayland-only, etc.).
let strategyPromise: Promise<HeartStrategy> | null = null;
const getHeartStrategy = (): Promise<HeartStrategy> => {
  if (!isTauriRuntime()) return Promise.resolve("inline");
  if (!strategyPromise) {
    strategyPromise = invoke<string>("get_heart_strategy")
      .then((s) => (s === "separate" || s === "inline" || s === "disabled" ? s : "inline"))
      .catch(() => "inline" as HeartStrategy);
  }
  return strategyPromise;
};

// Cache the ensure-window invocation so we only build the heart window once.
let ensureHeartPromise: Promise<void> | null = null;
const resetHeartWindowCache = () => {
  ensureHeartPromise = null;
};

const ensureHeartWindow = async (): Promise<void> => {
  if (!isTauriRuntime()) return;
  if (!ensureHeartPromise) {
    ensureHeartPromise = invoke<void>("ensure_heart_window").catch((err) => {
      ensureHeartPromise = null;
      throw err;
    });
  }
  return ensureHeartPromise;
};

const disposeHeartWindow = async (): Promise<void> => {
  if (!isTauriRuntime()) {
    resetHeartWindowCache();
    return;
  }

  const heart = await safeWindowByLabel("heart");
  if (!heart) {
    resetHeartWindowCache();
    return;
  }

  try {
    await heart.close();
  } catch {
    try {
      await heart.hide();
    } catch {
      /* ignore */
    }
  }

  resetHeartWindowCache();
};

/**
 * Show the milestone heart. Dispatches by strategy:
 *  - "separate": legacy second-window path (Windows + X11).
 *  - "inline":   emit an event the main window listens for and renders
 *                MilestoneHeartOverlay inside its own React tree.
 *  - "disabled": no-op.
 *
 * The inline path does NOT resize/move the main window — the main window
 * stays exactly where the user placed it; the overlay paints over the
 * timer chrome. (The overlay graphic is larger than the window, which is
 * expected: rendering is clipped to the window bounds, but the visible
 * portion still conveys the milestone, and no flicker/jump occurs.)
 */
export const showHeartWindow = async (payload: HeartPayload): Promise<void> => {
  const strategy = await getHeartStrategy();
  if (strategy === "disabled") return;

  if (strategy === "inline") {
    if (!isTauriRuntime()) return;
    try {
      await emit(HEART_INLINE_EVENT, payload);
    } catch {
      /* ignore */
    }
    return;
  }

  // strategy === "separate"
  if (!isTauriRuntime()) return;
  try {
    await ensureHeartWindow();
  } catch {
    // Window creation failed. Rust has already downgraded the runtime
    // strategy; reset our cache so the next call re-queries and falls
    // through to the inline path.
    strategyPromise = null;
    try {
      await emit(HEART_INLINE_EVENT, payload);
    } catch {
      /* ignore */
    }
    return;
  }

  const heart = await safeWindowByLabel("heart");
  if (!heart) {
    resetHeartWindowCache();
    strategyPromise = null;
    try {
      await emit(HEART_INLINE_EVENT, payload);
    } catch {
      /* ignore */
    }
    return;
  }
  try {
    clearHeartReplayTimers();
    // Clear any stale payload in the heart window FIRST so a previously
    // shown heart isn't visible when we re-show this window.
    try {
      await emit(HEART_CLEAR_EVENT);
    } catch {
      /* ignore */
    }
    const centeredPos = await getHeartWindowCenterPosition();
    await heart.setSize(new LogicalSize(HEART_WINDOW_SIZE, HEART_WINDOW_SIZE));
    await heart.setAlwaysOnTop(true);
    await heart.show();
    if (centeredPos) {
      await heart.setPosition(new LogicalPosition(centeredPos.x, centeredPos.y));
    }

    if (!centeredPos) {
      try {
        await heart.center();
      } catch {
        /* ignore */
      }
    }

    // Defer click-through until the GdkWindow is realized (tao#1178).
    // Failure inside the Rust command downgrades the strategy to inline;
    // we reset our cache so the next milestone re-queries.
    heartReplayTimers = [
      setTimeout(() => {
        if (centeredPos) {
          void heart.setPosition(new LogicalPosition(centeredPos.x, centeredPos.y)).catch(() => {
            /* ignore */
          });
        } else {
          void heart.center().catch(() => {
            /* ignore */
          });
        }
      }, 80),
      setTimeout(() => {
        void emit(HEART_EVENT, payload).catch(() => {
          /* ignore */
        });
      }, 120),
      setTimeout(() => {
        void emit(HEART_EVENT, payload).catch(() => {
          /* ignore */
        });
      }, 260),
    ];
    setTimeout(() => {
      void invoke("mark_heart_clickthrough").catch(() => {
        strategyPromise = null;
      });
    }, 80);

    await emit(HEART_EVENT, payload);
  } catch {
    // Final fallback: try inline.
    resetHeartWindowCache();
    strategyPromise = null;
    try {
      await emit(HEART_INLINE_EVENT, payload);
    } catch {
      /* ignore */
    }
  }
};

/**
 * Hide the milestone heart. For the separate-window strategy this hides
 * the dedicated window. For the inline strategy this asks the main window
 * to clear its overlay state.
 */
export const hideHeartWindow = async (): Promise<void> => {
  const strategy = await getHeartStrategy().catch(() => "inline" as HeartStrategy);
  if (isTauriRuntime()) {
    try {
      await emit(HEART_CLEAR_EVENT);
    } catch {
      /* ignore */
    }
  }

  if (strategy === "inline") {
    if (!isTauriRuntime()) return;
    clearHeartReplayTimers();
    try {
      await emit(HEART_INLINE_HIDE_EVENT);
    } catch {
      /* ignore */
    }
    return;
  }

  if (!isTauriRuntime()) return;
  clearHeartReplayTimers();
  await disposeHeartWindow();
};
