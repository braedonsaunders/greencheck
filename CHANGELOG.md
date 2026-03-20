# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
