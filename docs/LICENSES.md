# Licenses and corresponding source

Intelligence's original code is GPL-3.0-only, copyright 2026 Octavian and contributors. LICENSE and public/licenses/GPL-3.0.txt contain the full local text. COPYRIGHT identifies the original-code scope; third-party software and content retain their respective licenses.

Settings → Licenses reads complete bundled notices offline. public/licenses/index.json indexes collected dependency notices, fonts/icons and optional-module/model notices. Do not erase or relabel third-party attribution when changing product branding or versioning.

Before distributing a Linux AppImage, inventory its exact contents, including Electron/Chromium, native sharp/libvips constituents, runtime code, fonts/icons and notices. Top-level npm license strings alone are not sufficient. Preserve all required notices and provide complete corresponding source matching that binary, dependency source/relinking information where required, and the build scripts at no extra charge.

Optional engines/models/voices/ZIM content have separate terms and are not bundled. The private backup feature does not grant redistribution rights to arbitrary included content. Keep unresolved native/model/content obligations explicit; do not present development-source verification as distribution clearance.

## Bundled AppImage native libraries

electron-builder bundles six compatibility libraries into the AppImage's `usr/lib` for tray/notification and legacy X11 support: `libnotify.so.4.0.0` and `libgconf-2.so.4.1.5` (LGPL-2.1), `libindicator3.so.7.0.0` (GPL-3.0), `libappindicator3.so.1.0.0` (LGPL-3.0), and `libXtst.so.6.1.0`/`libXss.so.1.0.0` (X11). Their complete license texts accompany the binary as catalog entries in `public/licenses/native/` (GPL-3.0 via `public/licenses/GPL-3.0.txt`); `scripts/collect-license-notices.mjs` pins them into the notice catalog on every build. The binaries are stripped, so they are identified by SONAME file version rather than upstream source version.

## Source repository scope

The GitHub repository includes original code/assets, source and build scripts, dependency lockfiles, fonts/icons and complete local notices. It excludes node_modules, compiled application packages, user data, optional engines, voices, model weights and archive content. Source installer/catalog files and their license notices remain included so the application can provision optional components after a user's setup action.

The notice catalog's platform field describes the development environment where notices were collected; it is not an audit of a Linux application binary. Verify the actual packaged dependencies and their complete notices before distributing an AppImage.

Voluntary donations and paid support do not conflict with GPL-3.0-only and do not restrict recipients' freedoms. See the [GNU GPL text](https://www.gnu.org/licenses/gpl.en.html) and [GNU guidance on selling free software](https://www.gnu.org/philosophy/selling.en.html). The repository's Ko-fi link is voluntary.
