import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Play,
  Pause,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  X,
  Heart,
  Pencil,
  Pin,
  PinOff,
  Bell,
} from "lucide-react";
import {
  resizeWindow,
  startDragging,
  closeWindow,
  setAlwaysOnTop,
  showHeartWindow,
  hideHeartWindow,
  isTauri,
  HEART_INLINE_EVENT,
  HEART_INLINE_HIDE_EVENT,
  type HeartPayload,
} from "@/lib/tauriWindow";
import { listen } from "@tauri-apps/api/event";
import { MilestoneHeartOverlay } from "@/components/MilestoneHeartOverlay";

const PRESETS = [
  { label: "5m", seconds: 5 * 60 },
  { label: "10m", seconds: 10 * 60 },
  { label: "15m", seconds: 15 * 60 },
  { label: "30m", seconds: 30 * 60 },
];

const MINIMIZED_WINDOW = { width: 160, height: 50 };
const EXPANDED_WINDOW = { width: 260, height: 320 };

// Heart milestone animation timings (must stay in sync with index.css keyframes
// `heart-grow` 3500ms and `heart-fade-out` 1500ms).
const HEART_GROW_MS = 3500;
const HEART_FADE_MS = 1500;
const HEART_FADE_DELAY_MS = HEART_GROW_MS + 1000; // pause after grow before fading
const HEART_CLEAR_MS = HEART_FADE_DELAY_MS + HEART_FADE_MS;

const formatTime = (totalSeconds: number) => {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
};

const startDrag = async (e: React.MouseEvent) => {
  if (e.button !== 0) return;
  await startDragging();
};

const Index = () => {
  const [totalSeconds, setTotalSeconds] = useState(5 * 60);
  const [remaining, setRemaining] = useState(5 * 60);
  const [running, setRunning] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [editingCustom, setEditingCustom] = useState(false);
  const [customMin, setCustomMin] = useState("");
  const [pinned, setPinned] = useState(true);
  // Subtle in-timer flash when a milestone fires (heart graphic itself plays
  // in a separate Tauri window). This stays inside the mini-timer chrome and
  // never resizes/moves the main window.
  const [milestoneFlash, setMilestoneFlash] = useState(false);
  // Inline heart overlay state — used only when the Rust side reports the
  // "inline" strategy (Wayland-only Linux, or after a separate-window
  // failure downgrade). Rendered as a fixed-position overlay inside this
  // main window — no window resize/move occurs.
  const [inlineHeart, setInlineHeart] = useState<HeartPayload | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const customInputRef = useRef<HTMLInputElement>(null);
  const triggeredMilestones = useRef<Set<number>>(new Set());
  const heartTimeouts = useRef<ReturnType<typeof setTimeout>[]>([]);
  const heartKeyRef = useRef(0);

  // Listen for inline-overlay events emitted from tauriWindow.ts.
  useEffect(() => {
    if (!isTauri()) return;
    const unlisteners: Array<() => void> = [];
    void listen<HeartPayload>(HEART_INLINE_EVENT, (event) => {
      setInlineHeart(event.payload);
    }).then((fn) => unlisteners.push(fn));
    void listen(HEART_INLINE_HIDE_EVENT, () => {
      setInlineHeart(null);
      // webkit2gtk-4.1 (Linux) leaves a compositor "ghost" of the heart
      // around the transparent mini-timer window after the animation ends.
      // Force a repaint by toggling a no-op transform on the root element
      // so the compositor surface is fully invalidated. Cheap and harmless
      // on other platforms.
      if (typeof window !== "undefined" && /Linux/i.test(window.navigator.userAgent)) {
        const root = document.documentElement;
        root.style.transform = "translateZ(0)";
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            root.style.transform = "";
          });
        });
      }
    }).then((fn) => unlisteners.push(fn));
    return () => {
      unlisteners.forEach((fn) => fn());
    };
  }, []);

  useEffect(() => {
    if (running && remaining > 0) {
      intervalRef.current = setInterval(() => {
        setRemaining((prev) => {
          if (prev <= 1) {
            setRunning(false);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [running, remaining]);

  // Milestones fire at 50%, 25%, 12.5%, and 0% (Time's Up!) of total time.
  // The heart animation is rendered in a SEPARATE Tauri window (`heart`)
  // so the main timer window stays exactly where the user placed it.
  useEffect(() => {
    if (totalSeconds <= 0) return;
    if (!running && remaining !== 0) return;

    const milestones = [
      Math.floor(totalSeconds / 2),
      Math.floor(totalSeconds / 4),
      Math.floor(totalSeconds / 8),
      0,
    ];

    if (milestones.includes(remaining) && !triggeredMilestones.current.has(remaining)) {
      triggeredMilestones.current.add(remaining);
      clearHeartTimers(true);

      const remainingLabel = remaining === 0 ? "Time's Up!" : formatTime(remaining);
      heartKeyRef.current += 1;
      const key = heartKeyRef.current;

      // Subtle in-timer indicator (independent of the heart window).
      setMilestoneFlash(true);
      const flashOff = setTimeout(() => setMilestoneFlash(false), 1200);

      // Show heart in its own window — main window is NOT touched.
      void showHeartWindow({ phase: "grow", remainingLabel, key });

      const fadeTimeout = setTimeout(() => {
        void showHeartWindow({ phase: "erase", remainingLabel, key });
      }, HEART_FADE_DELAY_MS);

      const clearTimeoutId = setTimeout(() => {
        void hideHeartWindow();
      }, HEART_CLEAR_MS);

      heartTimeouts.current = [flashOff, fadeTimeout, clearTimeoutId];
    }
  }, [remaining, running, totalSeconds]);

  // Cleanup heart timeouts on unmount; also hide overlay window.
  useEffect(
    () => () => {
      clearHeartTimers();
      void hideHeartWindow();
    },
    [],
  );

  useEffect(() => {
    if (editingCustom && customInputRef.current) {
      customInputRef.current.focus();
    }
  }, [editingCustom]);

  const clearHeartTimers = (resetFlash = false) => {
    heartTimeouts.current.forEach(clearTimeout);
    heartTimeouts.current = [];
    if (resetFlash) setMilestoneFlash(false);
  };

  // Main window only resizes between MINIMIZED and EXPANDED — never for
  // milestones. The heart animation lives in its own dedicated window.
  useEffect(() => {
    const nextSize = expanded ? EXPANDED_WINDOW : MINIMIZED_WINDOW;
    void resizeWindow(nextSize.width, nextSize.height);
  }, [expanded]);

  const selectPreset = (seconds: number) => {
    setRunning(false);
    setTotalSeconds(seconds);
    setRemaining(seconds);
    setEditingCustom(false);
    clearHeartTimers(true);
    triggeredMilestones.current.clear();
  };

  const submitCustom = () => {
    const mins = parseInt(customMin, 10);
    if (mins > 0 && mins <= 999) {
      selectPreset(mins * 60);
    }
    setEditingCustom(false);
    setCustomMin("");
  };

  const toggleRun = () => {
    if (remaining === 0) return;
    setRunning((value) => !value);
  };

  const reset = () => {
    setRunning(false);
    setRemaining(totalSeconds);
    clearHeartTimers(true);
    triggeredMilestones.current.clear();
  };

  const togglePin = async () => {
    const next = !pinned;
    setPinned(next);
    await setAlwaysOnTop(next);
  };

  const closeApp = () => {
    void closeWindow();
  };

  const getTimerColor = () => {
    if (remaining === 0 || remaining <= 30) return "hsl(var(--timer-red))";
    if (remaining <= 120) return "hsl(var(--timer-yellow))";
    return "hsl(var(--timer-green))";
  };

  const getTimerGlow = () => {
    if (remaining <= 30) return "0 0 20px hsl(var(--timer-red) / 0.4)";
    if (remaining <= 120) return "0 0 15px hsl(var(--timer-yellow) / 0.25)";
    return "none";
  };

  // Compute next upcoming milestone label for the subtle hint shown in the
  // expanded view.
  const nextMilestoneLabel = (() => {
    if (totalSeconds <= 0) return null;
    const milestones = [
      Math.floor(totalSeconds / 2),
      Math.floor(totalSeconds / 4),
      Math.floor(totalSeconds / 8),
    ];
    const upcoming = milestones
      .filter((m) => m > 0 && m < remaining && !triggeredMilestones.current.has(m))
      .sort((a, b) => b - a)[0];
    return upcoming !== undefined ? formatTime(upcoming) : null;
  })();

  const progress = totalSeconds > 0 ? remaining / totalSeconds : 0;
  const ringSize = 80;
  const ringR = 34;

  return (
    <div
      className="flex h-screen w-screen items-start justify-center pt-1"
      style={{ background: "transparent" }}
    >
      <div
        className="relative rounded-xl border"
        style={{
          overflow: "visible",
          background: "hsl(var(--background) / 0.92)",
          backdropFilter: "blur(16px)",
          opacity: inlineHeart ? 0 : 1,
          pointerEvents: inlineHeart ? "none" : "auto",
          boxShadow: milestoneFlash
            ? "0 0 0 1px hsl(var(--primary) / 0.5), 0 4px 24px hsl(var(--primary) / 0.45)"
            : "0 4px 20px hsl(var(--primary) / 0.12), 0 1px 4px hsl(0 0% 0% / 0.08)",
          borderColor: milestoneFlash ? "hsl(var(--primary) / 0.6)" : "hsl(var(--border))",
          width: expanded ? 240 : "auto",
          transition: "width 0.2s ease, box-shadow 0.4s ease, border-color 0.4s ease, opacity 0.2s ease",
        }}
      >
        {/* Minimized view */}
        {!expanded && (
          <div className="flex items-center gap-1 px-2 py-1">
            <span
              onMouseDown={startDrag}
              className="flex-1 cursor-grab text-sm font-bold tabular-nums select-none"
              style={{ color: getTimerColor(), transition: "color 0.5s ease" }}
              aria-live="polite"
              aria-label={`Time remaining ${formatTime(remaining)}`}
            >
              {formatTime(remaining)}
            </span>
            {milestoneFlash && (
              <Heart
                className="h-3 w-3 animate-pulse"
                style={{ color: "hsl(var(--primary))" }}
                fill="hsl(var(--primary))"
                aria-hidden="true"
              />
            )}
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="rounded p-0.5 transition-colors hover:bg-muted/50"
              aria-label="Expand timer"
            >
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            </button>
          </div>
        )}

        {/* Expanded view */}
        {expanded && (
          <>
            {/* Titlebar */}
            <div
              className="flex items-center justify-between px-2 py-1"
              style={{ background: "linear-gradient(135deg, hsl(var(--primary) / 0.12), hsl(var(--secondary) / 0.08))" }}
            >
              {/* Drag surface — no interactive children */}
              <div
                onMouseDown={startDrag}
                className="flex flex-1 cursor-grab items-center gap-1 select-none"
              >
                <Heart className="h-2.5 w-2.5 pointer-events-none" style={{ color: "hsl(var(--primary))" }} fill="hsl(var(--primary))" />
                <span className="text-[9px] font-bold tracking-widest pointer-events-none" style={{ color: "hsl(var(--primary))" }}>
                  LOVABLE
                </span>
              </div>
              {/* Window controls — outside drag surface */}
              <div className="flex items-center">
                <button
                  type="button"
                  onClick={togglePin}
                  className="rounded p-0.5 transition-colors hover:bg-muted/50"
                  aria-label={pinned ? "Unpin window" : "Pin window on top"}
                  title={pinned ? "Unpin (currently always on top)" : "Pin on top"}
                >
                  {pinned ? (
                    <Pin className="h-3 w-3" style={{ color: "hsl(var(--primary))" }} />
                  ) : (
                    <PinOff className="h-3 w-3 text-muted-foreground" />
                  )}
                </button>
                <button type="button" onClick={() => setExpanded(false)} className="rounded p-0.5 transition-colors hover:bg-muted/50" aria-label="Collapse timer">
                  <ChevronUp className="h-3 w-3 text-muted-foreground" />
                </button>
                <button type="button" onClick={closeApp} className="rounded p-0.5 transition-colors hover:bg-destructive/20" aria-label="Close timer">
                  <X className="h-3 w-3 text-muted-foreground" />
                </button>
              </div>
            </div>

            <div className="flex flex-col items-center px-3 py-2">
              <div className="relative flex items-center justify-center" style={{ width: ringSize, height: ringSize }}>
                <svg width={ringSize} height={ringSize} className="absolute" style={{ transform: "rotate(-90deg)" }}>
                  <circle cx={ringSize / 2} cy={ringSize / 2} r={ringR} fill="none" stroke="hsl(var(--muted))" strokeWidth="4" />
                  <circle
                    cx={ringSize / 2}
                    cy={ringSize / 2}
                    r={ringR}
                    fill="none"
                    stroke={getTimerColor()}
                    strokeWidth="4"
                    strokeLinecap="round"
                    strokeDasharray={2 * Math.PI * ringR}
                    strokeDashoffset={2 * Math.PI * ringR * (1 - progress)}
                    style={{ transition: "stroke-dashoffset 0.5s ease, stroke 0.5s ease", filter: getTimerGlow() }}
                  />
                </svg>
                <span
                  className="text-xl font-bold tabular-nums"
                  style={{ color: getTimerColor(), transition: "color 0.5s ease" }}
                  aria-live="polite"
                  aria-label={`Time remaining ${formatTime(remaining)}`}
                >
                  {formatTime(remaining)}
                </span>
              </div>

              <div className="mt-1.5 flex items-center gap-1.5">
                <Button
                  size="icon"
                  variant="outline"
                  className="h-7 w-7 rounded-full border-primary/30 hover:bg-primary/10"
                  onClick={reset}
                  aria-label="Reset timer"
                >
                  <RotateCcw className="h-3 w-3" style={{ color: "hsl(var(--primary))" }} />
                </Button>
                <Button
                  size="icon"
                  className="h-8 w-8 rounded-full"
                  style={{
                    background: "linear-gradient(135deg, hsl(var(--primary)), hsl(var(--secondary)))",
                    boxShadow: "0 2px 10px hsl(var(--primary) / 0.35)",
                  }}
                  onClick={toggleRun}
                  aria-label={running ? "Pause timer" : "Start timer"}
                >
                  {running ? (
                    <Pause className="h-3.5 w-3.5 text-primary-foreground" />
                  ) : (
                    <Play className="ml-0.5 h-3.5 w-3.5 text-primary-foreground" />
                  )}
                </Button>
              </div>

              <div className="mt-2 flex flex-wrap items-center justify-center gap-1">
                {PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => selectPreset(preset.seconds)}
                    className="rounded-full px-2 py-0.5 text-[10px] font-semibold transition-all"
                    style={{
                      background:
                        totalSeconds === preset.seconds
                          ? "linear-gradient(135deg, hsl(var(--primary)), hsl(var(--secondary)))"
                          : "hsl(var(--muted))",
                      color:
                        totalSeconds === preset.seconds
                          ? "hsl(var(--primary-foreground))"
                          : "hsl(var(--muted-foreground))",
                    }}
                  >
                    {preset.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setEditingCustom(true)}
                  className="flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-semibold transition-all"
                  style={{
                    background: editingCustom
                      ? "linear-gradient(135deg, hsl(var(--primary)), hsl(var(--secondary)))"
                      : "hsl(var(--muted))",
                    color: editingCustom ? "hsl(var(--primary-foreground))" : "hsl(var(--muted-foreground))",
                  }}
                >
                  <Pencil className="h-2.5 w-2.5" />
                  Custom
                </button>
              </div>

              {editingCustom && (
                <div className="mt-1.5 flex items-center gap-1">
                  <input
                    ref={customInputRef}
                    type="number"
                    min={1}
                    max={999}
                    placeholder="min"
                    value={customMin}
                    onChange={(event) => setCustomMin(event.target.value)}
                    onKeyDown={(event) => event.key === "Enter" && submitCustom()}
                    className="h-6 w-12 rounded-md border border-input bg-background px-1 text-center text-[11px] focus:outline-none focus:ring-1 focus:ring-ring"
                    aria-label="Custom timer minutes"
                  />
                  <button
                    type="button"
                    onClick={submitCustom}
                    className="h-6 rounded-md px-2 text-[10px] font-semibold"
                    style={{
                      background: "linear-gradient(135deg, hsl(var(--primary)), hsl(var(--secondary)))",
                      color: "hsl(var(--primary-foreground))",
                    }}
                  >
                    Set
                  </button>
                </div>
              )}

              {/* Subtle next-milestone hint: tells the user when the next
                  heart warning will fire (50% / 25% / 12.5% of duration).
                  Kept low-contrast so it never competes with the timer. */}
              <div
                className="mt-2 flex items-center gap-1 text-[9px] text-muted-foreground/80"
                aria-live="polite"
                title="Heart warnings appear at 50%, 25%, and 12.5% of the timer"
              >
                <Bell className="h-2.5 w-2.5" aria-hidden="true" />
                <span>Warnings at 50%, 25%, 12% remaining</span>
              </div>
            </div>
          </>
        )}
      </div>
      {/* Inline heart overlay — rendered only when Rust strategy is "inline"
          (or after a separate-window failure downgrade). Click-through via
          pointer-events:none on the overlay itself. */}
      {inlineHeart && (
        <MilestoneHeartOverlay
          key={inlineHeart.key}
          overlayKey={inlineHeart.key}
          phase={inlineHeart.phase}
          remainingLabel={inlineHeart.remainingLabel}
        />
      )}
    </div>
  );
};

export default Index;
