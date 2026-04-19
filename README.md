# Lovable Timer

A small, always-on-top countdown timer for presentations. Built with Tauri, React, Vite, and Tailwind.

## Features

- Frameless, transparent floating window
- Quick presets (5 / 10 / 15 / 30 minutes) plus custom duration
- Color-coded countdown (green → yellow → red)
- Milestone heart animation overlay at the half / quarter / eighth marks
- Always-on-top with an in-app pin/unpin toggle
- Global keyboard shortcut to quit (Ctrl/Cmd + Q)

## Development

```bash
npm install --legacy-peer-deps
npm run dev          # web preview at http://localhost:8080
npm run tauri dev    # desktop app with hot reload (requires Rust toolchain)
```

## Build

```bash
npm run build         # production web bundle
npm run tauri build   # native installer/AppImage
```

CI builds Windows (NSIS) and Linux (`.deb` + AppImage) artifacts via GitHub Actions on tag push (`v*`). The Linux build targets **Ubuntu 24.04+ / Debian 13+** (`libwebkit2gtk-4.1`). For older distros (Ubuntu 22.04 / Debian 12) you need to build from source against `libwebkit2gtk-4.0`.

## Testing

```bash
npm test           # unit tests (vitest)
npm run lint       # eslint
```

## Project layout

- `src/` — React UI
- `src-tauri/` — Tauri v2 Rust shell, window config, capabilities
- `.github/workflows/build.yml` — multi-platform release pipeline

## Code signing

See [`SIGNING.md`](./SIGNING.md) for instructions on enabling Windows code signing in CI.

## License

MIT — see [`LICENSE`](./LICENSE).
