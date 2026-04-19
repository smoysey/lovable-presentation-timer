type ProbeEvent = {
  timestamp: string;
  type: string;
  target: string;
  focused: boolean;
  hidden: boolean;
};

declare global {
  interface Window {
    __WINDOW_PROBE__?: {
      events: ProbeEvent[];
      listenersAttached: boolean;
      pushEvent: (type: string, target?: EventTarget | null) => void;
      reset: () => void;
    };
  }
}

const getTargetLabel = (target?: EventTarget | null) => {
  if (!(target instanceof Element)) return "unknown";
  const id = target.id ? `#${target.id}` : "";
  const className = typeof target.className === "string" && target.className.trim()
    ? `.${target.className.trim().split(/\s+/).slice(0, 2).join(".")}`
    : "";
  return `${target.tagName.toLowerCase()}${id}${className}`;
};

export const installWindowProbe = () => {
  if (typeof window === "undefined") return;

  if (!window.__WINDOW_PROBE__) {
    window.__WINDOW_PROBE__ = {
      events: [],
      listenersAttached: false,
      pushEvent(type, target) {
        this.events.unshift({
          timestamp: new Date().toISOString(),
          type,
          target: getTargetLabel(target),
          focused: document.hasFocus(),
          hidden: document.hidden,
        });
        this.events = this.events.slice(0, 60);
      },
      reset() {
        this.events = [];
      },
    };
  }

  if (window.__WINDOW_PROBE__.listenersAttached) return;

  const push = (type: string) => (event?: Event) => {
    window.__WINDOW_PROBE__?.pushEvent(type, event?.target ?? document.activeElement);
  };

  document.addEventListener("pointerdown", push("pointerdown"), true);
  document.addEventListener("mousedown", push("mousedown"), true);
  document.addEventListener("click", push("click"), true);
  document.addEventListener("focusin", push("focusin"), true);
  window.addEventListener("focus", push("window-focus"), true);
  window.addEventListener("blur", push("window-blur"), true);
  document.addEventListener("visibilitychange", () => {
    window.__WINDOW_PROBE__?.pushEvent(document.hidden ? "document-hidden" : "document-visible", document.activeElement);
  });

  window.__WINDOW_PROBE__.pushEvent("probe-installed", document.body);
  window.__WINDOW_PROBE__.listenersAttached = true;
};
