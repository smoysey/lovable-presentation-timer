#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

/// Heart-overlay rendering strategy. Chosen once at startup based on the
/// detected platform / display server. Communicated to the frontend via the
/// `get_heart_strategy` command so the JS layer can branch accordingly.
///
/// - `separate`: spawn a dedicated transparent click-through always-on-top
///   second window. Known-good on Windows and on real X11 sessions.
/// - `inline`: do NOT create a second window — the frontend renders the
///   heart inside the main window (resizing/repositioning around it).
///   Used on Wayland-only sessions where a second transparent webview
///   crashes webkit2gtk-4.1.
/// - `disabled`: animation suppressed entirely. Last-resort fallback if
///   even Strategy A's window creation fails at runtime.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum HeartStrategy {
    Separate,
    Inline,
    #[allow(dead_code)]
    Disabled,
}

impl HeartStrategy {
    fn as_str(self) -> &'static str {
        match self {
            HeartStrategy::Separate => "separate",
            HeartStrategy::Inline => "inline",
            HeartStrategy::Disabled => "disabled",
        }
    }
}

/// Runtime-mutable strategy. Starts at the value chosen during `main()` setup
/// and may be downgraded (e.g. Separate -> Inline) if window creation fails.
struct HeartStrategyState(std::sync::Mutex<HeartStrategy>);

#[tauri::command]
fn get_heart_strategy(state: tauri::State<'_, HeartStrategyState>) -> String {
    state.0.lock().map(|s| s.as_str().to_string()).unwrap_or_else(|_| "inline".to_string())
}

/// Lazily create the heart overlay window on first request. Creating it at
/// startup (via tauri.conf.json) triggers tao#1178 on Linux. Building it on
/// demand sidesteps that race.
///
/// IMPORTANT: We DO NOT call `set_ignore_cursor_events` here. That call
/// panics in tao 0.34.x when the underlying GdkWindow isn't realized yet
/// (tao#1178). Click-through is applied later via `mark_heart_clickthrough`,
/// which the JS side invokes AFTER `show()` resolves.
#[tauri::command]
async fn ensure_heart_window(
    app: tauri::AppHandle,
    state: tauri::State<'_, HeartStrategyState>,
) -> Result<(), String> {
    if app.get_webview_window("heart").is_some() {
        return Ok(());
    }

    let builder = WebviewWindowBuilder::new(
        &app,
        "heart",
        WebviewUrl::App("index.html#/heart".into()),
    )
    .title("Lovable Timer Heart")
    .inner_size(620.0, 620.0)
    .resizable(false)
    .decorations(false)
    .transparent(true)
    .skip_taskbar(true)
    .focused(false)
    .visible(false)
    .shadow(false)
    .center();

    let window = match builder.build() {
        Ok(w) => w,
        Err(e) => {
            eprintln!(
                "[lovable-timer] heart window build failed: {} — downgrading to inline strategy",
                e
            );
            if let Ok(mut guard) = state.0.lock() {
                *guard = HeartStrategy::Inline;
            }
            return Err(e.to_string());
        }
    };

    // Always-on-top is safe to set pre-realization on every platform.
    if let Err(e) = window.set_always_on_top(true) {
        eprintln!("[lovable-timer] heart set_always_on_top failed: {}", e);
    }
    Ok(())
}

/// Apply click-through to the heart window AFTER it has been shown and
/// realized by the OS. Called from the JS layer ~50ms after `heart.show()`.
/// On failure (tao#1178 or otherwise), downgrades the runtime strategy to
/// Inline so the next milestone uses the in-process overlay.
#[tauri::command]
fn mark_heart_clickthrough(
    handle: tauri::AppHandle,
    state: tauri::State<'_, HeartStrategyState>,
) -> Result<(), String> {
    let Some(heart) = handle.get_webview_window("heart") else {
        return Err("heart window not found".to_string());
    };
    if let Err(e) = heart.set_ignore_cursor_events(true) {
        eprintln!(
            "[lovable-timer] mark_heart_clickthrough failed: {} — downgrading to inline strategy",
            e
        );
        if let Ok(mut guard) = state.0.lock() {
            *guard = HeartStrategy::Inline;
        }
        return Err(e.to_string());
    }
    Ok(())
}

/// Classify the active Linux display server based on env vars. Logged at
/// startup so bug reports include the exact session type.
#[cfg(target_os = "linux")]
fn classify_linux_session() -> &'static str {
    let xdg = std::env::var("XDG_SESSION_TYPE").unwrap_or_default();
    let has_wayland = std::env::var_os("WAYLAND_DISPLAY").is_some();
    let has_display = std::env::var_os("DISPLAY").is_some();
    match (xdg.as_str(), has_wayland, has_display) {
        ("wayland", true, true) => "wayland-with-xwayland",
        ("wayland", true, false) => "wayland-only",
        ("x11", _, true) => "x11",
        (_, true, true) => "wayland-with-xwayland",
        (_, true, false) => "wayland-only",
        (_, false, true) => "x11",
        _ => "unknown",
    }
}

fn main() {
    // ---- Linux: detect session, configure env, choose strategy ----
    #[cfg(target_os = "linux")]
    let initial_strategy = {
        let session = classify_linux_session();
        eprintln!("[lovable-timer] linux session detected: {}", session);

        // WEBKIT_* tweaks are safe on every Linux session and prevent known
        // crashes in webkit2gtk-4.1 (NVIDIA transparency, DMA-BUF renderer).
        if std::env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE").is_none() {
            std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
        }
        if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }

        // GDK_BACKEND=x11 is only safe when an X server (XWayland or native)
        // is actually reachable — i.e. DISPLAY is set. On wayland-only
        // sessions, forcing x11 makes GTK init fail unpredictably; let GTK
        // pick its native backend instead.
        let strategy = match session {
            "x11" | "wayland-with-xwayland" => {
                if std::env::var_os("GDK_BACKEND").is_none() {
                    std::env::set_var("GDK_BACKEND", "x11");
                }
                HeartStrategy::Separate
            }
            "wayland-only" => {
                // Do NOT force GDK_BACKEND. Use inline rendering to avoid
                // spawning a second transparent webview, which crashes here.
                HeartStrategy::Inline
            }
            _ => {
                // Unknown — be conservative and prefer x11 if DISPLAY exists.
                if std::env::var_os("DISPLAY").is_some()
                    && std::env::var_os("GDK_BACKEND").is_none()
                {
                    std::env::set_var("GDK_BACKEND", "x11");
                    HeartStrategy::Separate
                } else {
                    HeartStrategy::Inline
                }
            }
        };
        eprintln!(
            "[lovable-timer] heart strategy selected: {}",
            strategy.as_str()
        );
        strategy
    };

    // Windows / macOS: separate-window strategy is reliable.
    #[cfg(not(target_os = "linux"))]
    let initial_strategy = HeartStrategy::Separate;

    tauri::Builder::default()
        .manage(HeartStrategyState(std::sync::Mutex::new(initial_strategy)))
        .invoke_handler(tauri::generate_handler![
            ensure_heart_window,
            get_heart_strategy,
            mark_heart_clickthrough
        ])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_decorations(false);
                // Do NOT call `set_ignore_cursor_events` here — on Linux
                // the main window is transparent and not yet realized, so
                // tao 0.34.x panics on the bare `.unwrap()` in its
                // CursorIgnoreEvents handler (tao#1178). The main window
                // already receives cursor events by default.
                let _ = window.set_focus();
            }
            // The heart window is created lazily via the `ensure_heart_window`
            // command the first time a milestone fires (and only when the
            // chosen strategy is Separate).
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
