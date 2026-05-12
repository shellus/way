# Standalone Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide a GitHub Release package for Linux x64 that runs without npm, Node.js, Bun, or a system restic installation.

**Architecture:** Bun compiles `src/cli.ts` into a standalone `way` executable. The release archive ships that executable with the existing Linux x64 restic sidecar and example YAML files. Runtime restic resolution remains compatible with npm installs and adds standalone archive/install locations.

**Tech Stack:** TypeScript, Bun `build --compile`, GitHub Actions, Vitest.

---

### Task 1: Restic Sidecar Resolution

**Files:**
- Modify: `src/core/restic-bin.ts`
- Test: `tests/core/restic-bin.test.ts`

- [x] Add tests for standalone archive layout: `way-linux-x64/bin/way` resolves `way-linux-x64/vendor/restic/linux-x64/restic`.
- [x] Add tests for installed layout: `/usr/local/bin/way` resolves `/usr/local/lib/way/vendor/restic/linux-x64/restic`.
- [x] Implement sidecar candidate lookup after package-root lookup and before PATH fallback.
- [x] Run `npm run test:run -- tests/core/restic-bin.test.ts`.

### Task 2: Standalone Package Assembly

**Files:**
- Create: `scripts/package-release.mjs`
- Create: `scripts/install-release.sh`
- Modify: `package.json`

- [x] Add `build:standalone` script using `bun build --compile --target=bun-linux-x64-baseline`.
- [x] Add a Node packaging script that assembles `release/way-linux-x64` and creates `release/way-linux-x64.tar.gz`.
- [x] Add an install script that copies `bin/way` to the selected prefix and restic to the matching sidecar lib directory.

### Task 3: GitHub Release Workflow

**Files:**
- Create: `.github/workflows/release.yml`

- [x] Run tests on tag builds.
- [x] Install Bun in CI.
- [x] Build the standalone executable and archive.
- [x] Upload `way-linux-x64.tar.gz` to the GitHub Release.

### Task 4: Documentation

**Files:**
- Modify: `README.md`
- Modify: `CONTRIBUTING.md`

- [x] Document the recommended Linux x64 GitHub Release installation path.
- [x] Keep npm installation documented as an alternative.
- [x] Document the release flow for tag-triggered GitHub Release assets.

### Task 5: Verification

**Commands:**
- `npm run test:run`
- `npm run build`
- If Bun is available: `npm run package:linux-x64`

- [x] Confirm tests pass.
- [x] Confirm npm build still works.
- [x] Confirm archive creation works when Bun is installed.

## Follow-up Work

- README 中仍有 `way init` 示例，但当前 CLI 未提供 `init` 命令。该问题不属于独立发行包改动范围，后续应确认是补回 `init` 命令，还是将文档改为 `way restic init`。
