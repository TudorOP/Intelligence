# Build Intelligence 1.01 on Linux

Use the matching Intelligence-source.zip or this source checkout. Dev holds new work; main remains the default branch for reviewed releases. This local 1.01 source preparation has not been published. For ongoing development, first read [AGENT_HANDOFF.md](AGENT_HANDOFF.md); a source ZIP contains no Git history or user data. Install Docker Engine and the Compose plugin; no host Node/compiler/Electron SDK is needed for packaging.

```bash
docker compose run --build --rm appimage
chmod +x release/Intelligence-1.0.1-x86_64.AppImage
./release/Intelligence-1.0.1-x86_64.AppImage
```

The script rejects release packaging outside Linux Docker. Docker is not a runtime dependency. Run the AppImage as a regular user with the Electron sandbox enabled. Validate Wayland/X11, tray, desktop icon, single-instance reopening and mixed-DPI/font/scaling behavior.

Models, voices and optional speech/ZIM engines are downloaded into managed user data after their setup actions; none are bundled into the source archive/AppImage. Existing user data and provider credentials are separate from source. Data defaults to ~/.config/Intelligence, follows XDG_CONFIG_HOME and can be overridden by INTELLIGENCE_DATA_DIR.

Run npm test and the relevant desktop, Matrix, search, profile/workspace, Calendar/Reports, module, speech/report, Chat, chat-memory-order and theme fixtures in isolated directories. Verify still-background zero/maximum blur, imported images, theme independence, Pause AI/Resume and provider routing descriptions. Old animation preferences must remain inert after restart/restore. Decorative animation is removed and explicitly deferred. Screenshots on another host do not establish target hardware performance.

Validate real Piper/Kokoro/sherpa-onnx/libzim installation, voices, mic/device lifecycle and offline restore. Check real provider/MCP/search/ZIM/model task behavior, task triggers, sleep/resume, residency and idle release. Context-length benchmarks remain deferred; token-overhead work is not queued.

For 1.01, validate last-project and normal/maximized window restoration across display changes, both chat pickers, attachment/branch/backup retention, live folder/profile revocation and destructive-action review. Exercise an isolated downloads inbox with partial files, arrivals while busy, Pause AI, quit/restart and sleep/resume catch-up. Verify actual shell execution, command input/output, time limits, Stop and process-group cleanup as a regular Linux user. File-tool scope is not a shell sandbox. Monitoring requires the app open/in the tray; no standalone service or persistent shell state is included.

Complete the exact Linux binary/dependency/font/icon/native/content license audit and make corresponding source available alongside the binary before any public distribution. See RELEASE_CHECKLIST.md and LICENSES.md. No upload is authorized by local preparation.
