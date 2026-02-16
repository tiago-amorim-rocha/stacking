# Agent Instructions for This Repository

## Branch and Push Policy
- Codex should **always commit and push directly to `main`** in this repository.
- Do **not** create feature branches or PR-only workflows for normal agent changes.

## Access and Permissions
- The environment is configured with a PAT that grants Codex read/write access to this repository.
- Assume full read/write capabilities are available unless an explicit runtime error indicates otherwise. 
- This includes read/write access to repository content and explicit workflow read + edit rights for GitHub Actions/workflows.

## Project Context

### Overview
- This repository is a Vite + TypeScript web game project named **Stacking**.
- The runtime entrypoint is `src/main.ts` and the app uses `@box2d/core` for physics.
- The app is intended to run well on mobile browsers (including iOS Safari and Add-to-Home-Screen usage).

### Current Relevant Features
- **iOS/PWA-oriented shell** in `index.html`:
  - Apple mobile web app meta tags are configured.
  - Full-screen fixed canvas container and touch/scroll suppression are in place.
- **Debug overlay** (`src/debugOverlay.ts`):
  - Floating in-page console toggle (`🐛`) for on-device debugging.
  - Captures log/warn/error output and includes quick controls.
  - Shows build/version metadata.
- **Version metadata + update checks**:
  - Runtime checks `version.json` to detect new deployments.
  - GitHub Pages workflow (`.github/workflows/deploy-pages.yml`) writes fresh `dist/version.json` and `dist/version.txt` during deploy.

### Notes
- Some files from earlier template iterations may still exist (for example top-level `main.js` / `console.js`), but active app code is in `src/` and built with Vite.
