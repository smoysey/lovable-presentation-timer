# Code Signing

The CI pipeline builds **unsigned** Windows installers by default, which causes
Windows SmartScreen to warn end users on first launch. To produce a signed
installer, configure the following GitHub Actions secrets and the
`tauri.bundle.windows.certificateThumbprint` field in `src-tauri/tauri.conf.json`
(or wire `tauri-action` env vars `TAURI_PRIVATE_KEY` / `TAURI_KEY_PASSWORD` for
update-signing).

## Windows (Authenticode)

Required GitHub secrets:

| Secret | Purpose |
| --- | --- |
| `WINDOWS_CERTIFICATE` | Base64-encoded `.pfx` file |
| `WINDOWS_CERTIFICATE_PASSWORD` | Password for the `.pfx` |
| `WINDOWS_CERTIFICATE_THUMBPRINT` | SHA-1 thumbprint (uppercase, no spaces) |

Add a step before `tauri-apps/tauri-action@v0`:

```yaml
- name: Import code signing certificate (Windows)
  if: matrix.platform == 'windows-latest'
  shell: pwsh
  run: |
    $pfxPath = "$env:RUNNER_TEMP\\cert.pfx"
    [IO.File]::WriteAllBytes($pfxPath, [Convert]::FromBase64String("${{ secrets.WINDOWS_CERTIFICATE }}"))
    Import-PfxCertificate -FilePath $pfxPath -CertStoreLocation Cert:\\CurrentUser\\My -Password (ConvertTo-SecureString -String "${{ secrets.WINDOWS_CERTIFICATE_PASSWORD }}" -Force -AsPlainText)
```

Then set in `src-tauri/tauri.conf.json`:

```jsonc
"bundle": {
  "windows": {
    "certificateThumbprint": "<THUMBPRINT>",
    "digestAlgorithm": "sha256",
    "timestampUrl": "http://timestamp.digicert.com"
  }
}
```

## Linux

`.deb` and `AppImage` artifacts are unsigned. Distribute SHA-256 checksums
alongside the GitHub Release to let users verify integrity:

```bash
sha256sum *.AppImage *.deb > SHA256SUMS
```

## macOS

macOS builds are intentionally **out of scope** in this repo (no Apple
Developer account, no `macos-latest` matrix entry). If reintroducing macOS,
also configure notarization via `APPLE_ID`, `APPLE_PASSWORD`, and
`APPLE_TEAM_ID` secrets and re-add `icon.icns` to `tauri.conf.json`.
