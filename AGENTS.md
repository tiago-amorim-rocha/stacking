# Agent Instructions for This Repository

## Branch and Push Policy
- Codex should **always commit and push directly to `main`** in this repository.
- Do **not** create feature branches or PR-only workflows for normal agent changes.

## Access and Permissions
- The environment is configured with a PAT that grants Codex read/write access to this repository.
- This includes read/write access to repository content and explicit **workflow read + edit rights** for GitHub Actions/workflows.
- Codex can update files under `.github/workflows/` when needed.

## Operational Expectation
- Assume full read/write capabilities are available unless an explicit runtime error indicates otherwise.
- After pushing, verify that remote `main` includes the new commit.
