<p align="center">
  <img src="./logo-social.png" alt="greencheck banner" width="100%" />
</p>

<h1 align="center">greencheck</h1>

<p align="center">
  <strong>A GitHub Action that reads failed CI logs, asks a coding agent for the smallest fix, commits it, and waits for CI again.</strong>
</p>

<p align="center">
  <a href="https://github.com/braedonsaunders/greencheck/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/braedonsaunders/greencheck/ci.yml?branch=main&style=flat-square&label=CI" alt="CI"></a>
  <a href="https://github.com/braedonsaunders/greencheck/releases"><img src="https://img.shields.io/github/v/release/braedonsaunders/greencheck?style=flat-square&include_prereleases" alt="Release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="MIT License"></a>
</p>

<p align="center">
  <a href="#quickstart">Quickstart</a> ·
  <a href="#how-it-works">How It Works</a> ·
  <a href="#configuration">Configuration</a> ·
  <a href="#supported-languages">Languages</a> ·
  <a href="SKILL.md">Agent Skill</a> ·
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

---

## Why greencheck?

Most CI failures are small — a missing semicolon, a type mismatch, a renamed import. You know the fix in seconds, but the context-switch costs minutes. greencheck eliminates that friction:

- **Zero human intervention** — push code, go back to what you were doing
- **Scoped and safe** — it only touches files related to the failure, never lockfiles or secrets
- **Self-correcting** — if a fix introduces a regression, it automatically reverts
- **Cost-controlled** — hard limits on spend and runtime, with detailed cost reporting
- **Works with your stack** — parses logs from ESLint, TypeScript, Jest, Vitest, Pytest, Go, and Rust out of the box

greencheck is not trying to be an AI developer. It's a surgical CI repair tool that fixes the obvious stuff so you don't have to.

## What It Does

`greencheck` watches failed GitHub Actions runs, turns the logs into structured failures, asks [Claude Code](https://docs.anthropic.com/en/docs/claude-code) or [Codex](https://openai.com/index/codex/) for a targeted fix, commits the patch, and waits for CI to run again.

It is designed for `workflow_run`-based remediation flows and includes:

- **Multi-language log parsing** — ESLint, Biome, TypeScript, Jest, Vitest, Pytest, Go, and Rust
- **Scoped commits** — out-of-scope edits are filtered; only relevant changes land
- **Regression detection** — new failures after a fix trigger an automatic revert
- **Reporting** — PR comments, GitHub Actions job summaries, and Slack notifications
- **Safety guardrails** — cost limits, timeouts, protected files, stale-context detection
- **Checkpoint/resume** — long-running fix sessions survive re-runs

## Quickstart

```yaml
name: greencheck

on:
  workflow_run:
    workflows: ["CI"]
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

For Claude Code with OAuth instead of an API key:

```yaml
      - uses: braedonsaunders/greencheck@v0
        with:
          agent: claude
          agent-oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          github-token: ${{ secrets.GITHUB_TOKEN }}
          trigger-token: ${{ secrets.GREENCHECK_TOKEN }}
```

For Codex:

```yaml
      - uses: braedonsaunders/greencheck@v0
        with:
          agent: codex
          agent-api-key: ${{ secrets.OPENAI_API_KEY }}
          github-token: ${{ secrets.GITHUB_TOKEN }}
          trigger-token: ${{ secrets.GREENCHECK_TOKEN }}
```

> **Note:** Codex requires `agent-api-key`. OAuth-only Codex auth is not supported in this action.

A complete example workflow lives at [`examples/greencheck.workflow.yml`](examples/greencheck.workflow.yml).

## How It Works

```
CI fails → greencheck downloads logs → parses into structured failures
  → clusters by type & directory → picks highest-priority cluster
  → invokes Claude Code / Codex with a scoped prompt
  → filters out-of-scope edits → commits in-scope changes
  → pushes → waits for CI → repeats if needed
```

1. A monitored workflow finishes with `failure`.
2. greencheck downloads the failed job logs and parses them into structured failures.
3. It prioritizes the next fixable cluster and invokes Claude Code or Codex with a narrow prompt.
4. If the agent edits files outside the failure scope, greencheck discards those edits and only commits the remaining in-scope changes.
5. It pushes the fix and waits for the next workflow run on that commit.
6. If new failures appear, it reverts the regressive commit and continues.
7. The action refuses to operate on stale logs — if the branch has advanced since the failed run, it exits.

## Supported Languages

| Language | Parser | Failure Types |
|----------|--------|---------------|
| **JavaScript/TypeScript** | ESLint, Biome | Lint errors |
| **TypeScript** | tsc | Type errors |
| **JavaScript/TypeScript** | Jest, Vitest | Test failures, snapshot failures |
| **Python** | Pytest | Test failures, collection errors |
| **Go** | go test, go build | Test failures, build errors |
| **Rust** | rustc, cargo | Build errors, test panics |

## Configuration

Configure greencheck with a `.greencheck.yml` file in your repository root. Explicit action inputs always override repository config values.

```yaml
watch:
  workflows: [CI, Lint]
  branches: [main, develop]
  ignore-authors: [dependabot]

fix:
  agent: claude
  model: claude-sonnet-4-20250514
  types: [lint, type-error, test-failure]
  max-passes: 5
  max-cost: "$3.00"
  timeout: 20m

merge:
  enabled: false
  max-commits: 3
  require-label: true
  protected-patterns: [main, master, develop, release/*]

report:
  pr-comment: true
  job-summary: true
  slack-webhook: https://hooks.slack.com/services/...

safety:
  never-touch-files: ["*.lock", "package-lock.json", ".env*"]
  max-files-per-fix: 10
  revert-on-regression: true
```

## Inputs

| Input | Description | Default |
|-------|-------------|---------|
| `agent` | `claude` or `codex` | `claude` |
| `agent-api-key` | API key for the selected agent | — |
| `agent-oauth-token` | Claude Code OAuth token (alternative to API key) | — |
| `github-token` | GitHub token for read/report operations | **required** |
| `trigger-token` | PAT or App token for push and rerun | **required** |
| `max-passes` | Max fix/verify cycles | `5` |
| `max-cost` | Hard spend limit per run | `$3.00` |
| `timeout` | Total runtime budget | `20m` |
| `auto-merge` | Enable auto-merge after green CI | `false` |
| `watch-workflows` | Comma-separated workflow names to watch | all |
| `fix-types` | Failure types to fix (`lint`, `type-error`, `test-failure`, `build-error`, `runtime-error`, or `all`) | `all` |
| `model` | Override the default agent model | — |
| `dry-run` | Parse and report only, do not push | `false` |
| `config-path` | Custom path to `.greencheck.yml` | `.greencheck.yml` |
| `workflow-run-id` | Workflow run override for troubleshooting | — |

## Outputs

| Output | Description |
|--------|-------------|
| `fixed` | Whether CI was fixed (`true`/`false`) |
| `passes` | Number of fix/verify cycles used |
| `failures-found` | Number of failures detected |
| `failures-fixed` | Number of failures resolved |
| `commits` | Comma-separated list of fix commit SHAs |
| `cost` | Estimated LLM API cost for this run |

## Guardrails

- **Stale context rejection** — skips if the branch moved past the failed commit
- **Protected file filtering** — never modifies lockfiles, `.env`, or custom patterns
- **Out-of-scope edit filtering** — discards agent changes to files not in the failure cluster
- **Regression revert** — automatically reverts commits that introduce new failures
- **Cost and time limits** — hard caps on spend and wall-clock time
- **Auto-merge safety** — requires PR approval, optional label gating, protected branch patterns

## Local Development

```bash
npm install
npm test          # vitest
npm run lint      # eslint
npm run typecheck # tsc --noEmit
npm run build     # ncc bundle → dist/
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## Troubleshooting

**greencheck skips with "stale failure context"**
The branch advanced after the failed run. greencheck only operates on the exact commit that failed. This is a safety feature — it won't patch the wrong code. Re-push or re-run the failed workflow.

**"All changed files are protected, discarding changes"**
The agent tried to modify files matching your `safety.never-touch-files` patterns (e.g., lockfiles, `.env`). greencheck discards those changes. If the fix genuinely requires modifying a protected file, adjust the patterns in `.greencheck.yml`.

**"Cost limit reached"**
greencheck hit the `max-cost` cap. Increase it in your workflow or `.greencheck.yml`, or narrow `fix-types` to reduce the number of fix attempts.

**"Timed out waiting for CI"**
The CI pipeline took longer than the remaining time budget. Increase `timeout` or optimize your CI pipeline.

**Agent installation fails**
greencheck auto-installs Claude Code or Codex via `npm install -g`. If this fails, pre-install the agent in a prior workflow step:
```yaml
- run: npm install -g @anthropic-ai/claude-code@latest
```

**No failures found in logs**
The CI log format may not match any parser. [Open an issue](https://github.com/braedonsaunders/greencheck/issues/new?template=bug_report.yml) with the log snippet and we'll add support.

## Agent Skill

Using an AI coding agent to set up greencheck? **[SKILL.md](SKILL.md)** is a procedural skill file that any LLM agent (Claude Code, Codex, Cursor, OpenCode, etc.) can load and execute step-by-step to install and configure greencheck in any repository. It includes trigger conditions, numbered steps, all inputs/outputs, and a pitfalls section.

## License

[MIT](LICENSE)
