

## Root cause confirmed: tao#1178 — `set_ignore_cursor_events` on unrealized transparent window

### What I learned from upstream (tao#1178, opened Jan 26 2026, PR #1204 still open)

The panic at `tao-0.34.8/.../event_loop.rs:448` is a **bare `.unwrap()` in tao's `CursorIgnoreEvents` handler**. It fires when Tauri asks for `set_ignore_cursor_events(...)` on a window whose underlying `GdkWindow` hasn't been **realized** yet (i.e. `show()` hasn't completed and laid the window out on screen). The crash is most likely on **transparent + hidden** windows, because they delay realization.

Stack trace from your crash:
```
12: glib::main_context_channel::dispatch
15: g_main_context_iteration
16: gtk_main_iteration_do
17: gtk::auto::functions::main_iteration_do
18: tao::platform_impl::platform::event_loop::EventLoop::run
```

The cursor-ignore call is *queued* during setup, then dispatched on the **first** main-loop iteration. That's why the crash happens at startup, before a single milestone fires — and why the previous "lazy heart window" plan didn't help.

### Where our code triggers it

1. `src-tauri/src/main.rs` line 190: `window.set_ignore_cursor_events(false)` on the **main** window inside `setup()`. The main window is `transparent: true` and not yet realized → boom.
2. `src-tauri/src/main.rs` line 99: `window.set_ignore_cursor_events(true)` on the **heart** window before `show()`. Same bug class.

### Fix — three layered changes

**1. Stop calling `set_ignore_cursor_events` on unrealized windows (kills the startup crash today, no fork needed)**
- Remove `window.set_ignore_cursor_events(false)` from `main.rs` `setup()`. It's a no-op anyway — windows default to receiving cursor events, and we never enabled ignore on the main window.
- For the heart window: defer `set_ignore_cursor_events(true)` until **after** the JS side calls `show()` and the window is on screen. Move the call out of `ensure_heart_window` and into a new dedicated command `mark_heart_clickthrough` invoked from the frontend right after `heart.show()` resolves, with a short `setTimeout` to let GTK realize the window.

**2. Pin a patched tao via `[patch.crates-io]` (defense in depth, in case some Tauri-internal path also hits the unwrap)**
- Add to `src-tauri/Cargo.toml`:
  ```toml
  [patch.crates-io]
  tao = { git = "https://github.com/JGSimi/tao", branch = "fix-cursor-ignore-unwrap" }
  ```
  This is the same fork upstream commenters are using; it replaces the bare `.unwrap()` with `if let Some(gdk_window) = window.window()`. We revert the patch block once tao#1204 ships on crates.io.

**3. Keep the per-session strategy from the previous plan, but adjust dispatch**
- Strategy detection (`Separate` / `Inline` / `Disabled`) stays — it's still the right design for the second-window crash class.
- The `Separate` path now dispatches `mark_heart_clickthrough` after `show()` resolves (with ~50ms delay) instead of setting click-through during construction.
- If the deferred click-through call still fails, the Rust command catches it, logs it, downgrades the strategy to `Inline`, and the JS layer falls through on the next milestone.

### Files to change

- `src-tauri/Cargo.toml` — add `[patch.crates-io] tao = ...` block.
- `src-tauri/src/main.rs` — remove `set_ignore_cursor_events(false)` from `setup()`; remove `set_ignore_cursor_events(true)` from `ensure_heart_window`; add new `#[tauri::command] mark_heart_clickthrough` that calls it on the already-shown heart window with try/catch + strategy downgrade.
- `src/lib/tauriWindow.ts` — in the `separate` branch of `showHeartWindow`, after `await heart.show()` succeeds, schedule `setTimeout(() => invoke("mark_heart_clickthrough"), 50)`. Failure (caught) downgrades strategy and re-emits as `inline`.
- `mem://architecture/distribution-cicd` — note the tao#1178 cause and the patch-pin workaround so we know to remove it once tao ships the fix on crates.io.

### Verification (after switching to default mode)

Ask the user to:
1. Rebuild (`cargo update -p tao` to pick up the patch) and reinstall the .deb.
2. Run from terminal — confirm startup logs show the session + strategy and the timer launches without the `tao` panic.
3. Trigger a milestone (50% / 25% / 12%); confirm the heart appears and the timer doesn't crash whether or not click-through finalizes.

### Out of scope

- Heart visuals.
- App version bump.
- Removing the per-session strategy logic — it stays as defense for the wayland-only crash class.

