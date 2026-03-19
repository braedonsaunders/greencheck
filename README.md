<p align="center">
  <img src="./logo-social.png" alt="greencheck banner" width="100%" />
</p>

<h1 align="center">greencheck</h1>

<p align="center">
  <strong>A GitHub Action that reads failed CI logs, asks a coding agent for the smallest fix, commits it, and waits for CI again.</strong>
</p>

<p align="center">
  <a href="#quickstart">Quickstart</a> |
  <a href="#how-it-works">How It Works</a> |
  <a href="#configuration">Configuration</a>
</p>

## What It Does

`greencheck` watches failed GitHub Actions runs, turns the logs into structured failures, asks Claude Code or Codex for a targeted fix, commits the patch, and waits for CI to run again.

It is designed for `workflow_run`-based remediation flows and includes:

- log parsing for ESLint/Biome, TypeScript, Jest/Vitest, Pytest, Go, and Rust output
- scoped commits with out-of-scope edit filtering
- regression detection and revert handling
- PR comments and GitHub Actions job summaries

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

For Claude Code, you can use OAuth instead of an API key:

```yaml
      - uses: braedonsaunders/greencheck@v0
        with:
          agent: claude
          agent-oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          github-token: ${{ secrets.GITHUB_TOKEN }}
          trigger-token: ${{ secrets.GREENCHECK_TOKEN }}
```

For Codex in CI, use `agent-api-key`. Codex OAuth-only auth is not supported in this action.

A complete example workflow lives at `examples/greencheck.workflow.yml`.

## How It Works

1. A monitored workflow finishes with `failure`.
2. `greencheck` downloads the failed job logs and parses them into structured failures.
3. It prioritizes the next fixable cluster and invokes Claude Code or Codex with a narrow prompt.
4. If the agent edits files outside the failure scope, `greencheck` discards those edits and only commits the remaining in-scope changes.
5. It waits for the next workflow run on that commit.
6. If new failures appear, it can revert the regressive commit and continue.

The action also refuses to operate on stale logs. If the branch has advanced since the failed run, it exits instead of patching the wrong commit.

## Configuration

You can also configure `greencheck` with a `.greencheck.yml` file. Explicit action inputs override repository config values.

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

safety:
  never-touch-files: ["*.lock", "package-lock.json", ".env*"]
  max-files-per-fix: 10
  revert-on-regression: true
```

## Inputs

| Input | Description |
|---|---|
| `agent` | `claude` or `codex` |
| `agent-api-key` | API key for the selected agent |
| `agent-oauth-token` | Claude Code OAuth token |
| `github-token` | GitHub token for read/report operations |
| `trigger-token` | token used for push and rerun operations |
| `max-passes` | max fix/verify cycles |
| `max-cost` | hard spend limit |
| `timeout` | total runtime budget |
| `auto-merge` | enable auto-merge after green CI |
| `watch-workflows` | comma-separated workflow names to watch |
| `fix-types` | comma-separated failure types or `all` |
| `model` | override agent model |
| `dry-run` | parse and report only, do not push |
| `config-path` | custom path to `.greencheck.yml` |
| `workflow-run-id` | advanced workflow run override for troubleshooting |

## Guardrails

- The action is designed for `workflow_run` automation.
- It skips stale failure contexts when the branch moved after the failed run.
- It filters out protected files before commit.
- Auto-merge is optional and can be gated by labels, approvals, and protected-branch patterns.

## Local Development

```bash
npm install
npm test
npm run lint
npm run typecheck
npm run build
```

## License

MIT
