# AGENTS.md — LLM Agent Instructions for greencheck

You are an AI coding agent being asked to set up **greencheck** in a repository.
greencheck is a GitHub Action that automatically fixes failed CI runs using Claude Code or Codex.

## What greencheck does

When a CI workflow fails, greencheck:
1. Downloads and parses the failed job logs
2. Clusters failures by type (lint, type-error, test-failure, build-error)
3. Invokes Claude Code or Codex with a scoped prompt
4. Commits only in-scope file changes
5. Pushes, waits for CI, and repeats if needed
6. Reverts automatically if a fix introduces regressions

Supported log formats: ESLint, Biome, TypeScript (tsc), Jest, Vitest, Pytest, Go (test + build), Rust (rustc + cargo).

## Prerequisites

The target repository needs:
1. An existing CI workflow (GitHub Actions) that runs on push/PR
2. A GitHub PAT (fine-grained) with `contents: write` and `actions: read` scopes, stored as a repo secret (typically `GREENCHECK_TOKEN`)
3. An LLM API key stored as a repo secret:
   - For Claude Code: `ANTHROPIC_API_KEY` (or `CLAUDE_CODE_OAUTH_TOKEN` for OAuth)
   - For Codex: `OPENAI_API_KEY`

## Installation steps

### Step 1: Identify the CI workflow name

Look at the target repo's `.github/workflows/` directory. Find the workflow file(s) that run CI (tests, lint, typecheck, build). Note the `name:` field — you need it for the `workflows:` trigger list.

Common names: `CI`, `Tests`, `Lint`, `Build`, `test`, `ci`.

### Step 2: Create the greencheck workflow

Create `.github/workflows/greencheck.yml` with this content:

```yaml
name: greencheck

on:
  workflow_run:
    workflows: ["CI"]  # Replace with the actual CI workflow name(s)
    types: [completed]

permissions:
  actions: read
  contents: write
  issues: write
  pull-requests: write

jobs:
  fix:
    if: ${{ github.event.workflow_run.conclusion == 'failure' }}
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.workflow_run.head_sha }}
          fetch-depth: 0
          token: ${{ secrets.GREENCHECK_TOKEN }}

      - uses: braedonsaunders/greencheck@v0
        with:
          agent: claude
          agent-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
          github-token: ${{ secrets.GITHUB_TOKEN }}
          trigger-token: ${{ secrets.GREENCHECK_TOKEN }}
```

Replace `"CI"` in the `workflows:` list with the actual workflow name(s) from Step 1. Multiple names are supported: `["CI", "Lint", "Tests"]`.

### Step 3 (optional): Add repository configuration

Create `.greencheck.yml` in the repository root for fine-tuned control:

```yaml
watch:
  workflows: [CI]           # Which workflows to monitor
  branches: [main, develop] # Which branches to fix (omit for all)
  ignore-authors: [dependabot, renovate]  # Skip bot-authored failures

fix:
  agent: claude
  model: claude-sonnet-4-20250514  # Optional model override
  types: [lint, type-error, test-failure]  # Failure types to fix (or omit for all)
  max-passes: 5             # Max fix/verify cycles
  max-cost: "$3.00"         # Hard spend limit per run
  timeout: 20m              # Total runtime budget

safety:
  never-touch-files:         # Glob patterns for files the agent must never modify
    - "*.lock"
    - "package-lock.json"
    - ".env*"
    - ".github/**"
  max-files-per-fix: 10     # Max files in a single fix cluster
  revert-on-regression: true # Auto-revert if fix introduces new failures

report:
  pr-comment: true           # Post a report comment on the PR
  job-summary: true          # Write a GitHub Actions job summary

merge:
  enabled: false             # Auto-merge after green CI (disabled by default)
  max-commits: 3             # Max fix commits before refusing to merge
  require-label: true        # Require "greencheck:auto-merge" label on PR
  protected-patterns:        # Never auto-merge to these branches
    - main
    - master
    - release/*
```

## Agent selection

| Agent | Secret needed | Auth method |
|-------|--------------|-------------|
| `claude` | `ANTHROPIC_API_KEY` | API key |
| `claude` | `CLAUDE_CODE_OAUTH_TOKEN` | OAuth (use `agent-oauth-token` input) |
| `codex` | `OPENAI_API_KEY` | API key only (OAuth not supported) |

## All action inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `agent` | no | `claude` | `claude` or `codex` |
| `agent-api-key` | conditional | — | API key (required unless using OAuth) |
| `agent-oauth-token` | conditional | — | Claude Code OAuth token |
| `github-token` | yes | — | GitHub token for API reads and PR comments |
| `trigger-token` | yes | — | PAT for push and workflow rerun |
| `max-passes` | no | `5` | Max fix/verify cycles |
| `max-cost` | no | `$3.00` | Hard spend limit |
| `timeout` | no | `20m` | Total runtime budget |
| `auto-merge` | no | `false` | Auto-merge after green CI |
| `watch-workflows` | no | all | Comma-separated workflow names |
| `fix-types` | no | `all` | `lint`, `type-error`, `test-failure`, `build-error`, `runtime-error`, or `all` |
| `model` | no | — | Override the default agent model |
| `dry-run` | no | `false` | Parse and report without pushing |
| `config-path` | no | `.greencheck.yml` | Path to config file |
| `workflow-run-id` | no | — | Override for troubleshooting |

## All action outputs

| Output | Description |
|--------|-------------|
| `fixed` | `true` if CI was fixed |
| `passes` | Number of fix/verify cycles used |
| `failures-found` | Total failures detected |
| `failures-fixed` | Total failures resolved |
| `commits` | Comma-separated fix commit SHAs |
| `cost` | Estimated LLM API cost |

## Common patterns

### Codex instead of Claude

```yaml
      - uses: braedonsaunders/greencheck@v0
        with:
          agent: codex
          agent-api-key: ${{ secrets.OPENAI_API_KEY }}
          github-token: ${{ secrets.GITHUB_TOKEN }}
          trigger-token: ${{ secrets.GREENCHECK_TOKEN }}
```

### Only fix lint and type errors (skip test failures)

```yaml
      - uses: braedonsaunders/greencheck@v0
        with:
          agent: claude
          agent-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
          github-token: ${{ secrets.GITHUB_TOKEN }}
          trigger-token: ${{ secrets.GREENCHECK_TOKEN }}
          fix-types: lint,type-error
```

### Dry-run mode (diagnose without pushing)

```yaml
      - uses: braedonsaunders/greencheck@v0
        with:
          agent: claude
          agent-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
          github-token: ${{ secrets.GITHUB_TOKEN }}
          trigger-token: ${{ secrets.GREENCHECK_TOKEN }}
          dry-run: true
```

### Prevent concurrent runs on the same branch

Add a concurrency block to the job:

```yaml
jobs:
  fix:
    if: ${{ github.event.workflow_run.conclusion == 'failure' }}
    runs-on: ubuntu-latest
    concurrency:
      group: greencheck-${{ github.event.workflow_run.head_branch }}
      cancel-in-progress: true
```

## Secrets the user must configure

After you create the workflow file, tell the user they need to add these secrets in their repo settings (Settings → Secrets and variables → Actions):

1. **`GREENCHECK_TOKEN`** — A GitHub PAT (fine-grained) with:
   - `contents: write` (to push fix commits)
   - `actions: read` (to download logs and rerun workflows)
   - Scoped to the target repository

2. **`ANTHROPIC_API_KEY`** — Their Anthropic API key (if using Claude)
   OR **`OPENAI_API_KEY`** — Their OpenAI API key (if using Codex)

`GITHUB_TOKEN` is automatically available — do not ask the user to create it.

## Verification

After setup, the user can test by intentionally breaking CI (e.g., add a TypeScript type error or ESLint violation), pushing it, and watching the greencheck workflow trigger after the CI failure.

## Troubleshooting tips to share with the user

- **greencheck never triggers**: The `workflows:` list must exactly match the `name:` field in the CI workflow file (case-sensitive).
- **"stale failure context" skip**: The branch moved after the failure. greencheck only fixes the exact commit that failed.
- **"All changed files are protected"**: The fix required modifying a file in `never-touch-files`. Adjust the patterns if needed.
- **Agent installation fails**: Pre-install in a prior step: `npm install -g @anthropic-ai/claude-code@latest`
