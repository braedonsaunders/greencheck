# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.4] - 2026-04-25

### Fixed
- Ensure fix pushes use `trigger-token` instead of checkout's persisted `GITHUB_TOKEN` credentials
- Stop waiting for the full timeout when no follow-up workflow run exists and the dispatch fallback fails

## [0.1.3] - 2026-04-20

### Fixed
- Updated install examples and setup guidance so `actions/checkout` uses the default `GITHUB_TOKEN`
- Clarified that `GREENCHECK_TOKEN` should be reserved for greencheck's `trigger-token` push/rerun flow
- Added troubleshooting guidance for checkout auth failures in `workflow_run` setups
- Added a `workflow_dispatch` fallback when a pushed fix commit does not immediately create a follow-up GitHub Actions run
- Documented that watched CI workflows should declare `workflow_dispatch:` and that `GREENCHECK_TOKEN` needs `actions: write` for that fallback

## [0.1.1] - 2026-03-19

### Fixed
- Improved checkpoint state handling for resumed runs
- Better error messages for missing authentication tokens

## [0.1.0] - 2026-03-19

### Added
- Multi-language CI log parsing: ESLint, Biome, TypeScript, Jest/Vitest, Pytest, Go, and Rust
- Claude Code and OpenAI Codex agent support with auto-installation
- Fix/verify loop with configurable max passes, cost limits, and timeouts
- Scoped commits that filter out-of-scope file changes
- Regression detection with automatic revert
- PR comments with detailed fix reports
- GitHub Actions job summaries
- Checkpoint/resume for long-running fix sessions
- Repository configuration via `.greencheck.yml`
- Auto-merge with safety guards (label gating, approval requirement, protected branch patterns)
- Slack webhook notifications
- Dry-run mode for diagnosis without pushing
- Protected file patterns (lockfiles, .env, etc.)
