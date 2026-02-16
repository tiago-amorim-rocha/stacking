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
- The app is intended to run well on Add-to-Home-Screen usage, a.k.a PWA.
