# greencheck

**Your CI, Always Green.**

greencheck is a GitHub Action that monitors your CI pipeline and autonomously fixes failures using LLM-powered coding agents. When lint, tests, type checks, or builds fail, greencheck reads the CI logs, diagnoses the root cause, generates a fix, pushes the commit, and re-runs CI — looping until the pipeline is green or a configurable limit is reached.

Unlike broad AI code review tools, greencheck has a single obsession: keep your CI green. It doesn't generate features, review PRs for style, or scan for vulnerabilities. It watches for red, and it makes it green.

---

## Problem

CI failures are the most common source of developer context-switching. A typical workflow: push code, wait for CI, see failure, context-switch back, read logs, fix the issue, push again, wait again. This loop wastes 30–60 minutes per failure and fragments deep work.

The problem compounds in teams. A broken main branch blocks everyone. Flaky tests erode trust in the pipeline. Lint failures on trivial formatting waste senior engineer time. These are exactly the kinds of mechanical, log-reading, pattern-matching tasks that LLMs excel at.

---

## How It Works

greencheck is a **persistent CI guardian**. The core loop:

**detect failure → read logs → diagnose → fix → push → re-run → repeat**

### Core Principles

- **Relentless iteration:** greencheck doesn't suggest fixes. It fixes, verifies, and loops until CI passes or limits are hit.
- **CI-native:** Built as a GitHub Action. Runs where your CI runs. No external infrastructure.
- **Log-first diagnosis:** Reads actual CI output — compiler errors, test failures, lint violations — not abstract code analysis.
- **Minimal blast radius:** Atomic commits. Each fix is one commit. Easy to revert. Never touches unrelated code.
- **Cost-aware:** Hard limits on spend, passes, and runtime. Never runs away.
- **Official CLI agents:** Delegates to the `claude` (Claude Code) and `codex` (OpenAI Codex CLI) agents directly. Supports both API key and OAuth authentication. greencheck is the orchestrator, not the model provider.

---

## Competitive Positioning

The CI auto-fix space is active but fragmented. No tool owns the "persistent CI guardian" niche.

| Tool | Focus | Auto-merge? | Loop? | CI-native? |
|------|-------|-------------|-------|------------|
| Gitar | Test failure resolution | Optional | No | GitHub Actions |
| Ellipsis.dev (YC W24) | Broad AI dev tool | No | No | Docker containers |
| GitHub Copilot Autofix | Security alerts only | No | No | Native |
| Sentry AI Autofix | Production errors | No | No | External |
| DeepSource Autofix | Code quality issues | No | No | External |
| Sweep AI | Bug/feature requests | No | Partial | External |
| **greencheck** | **ALL CI failures** | **Yes** | **Yes** | **GitHub Action** |

**Key differentiator:** greencheck is the only tool that combines autonomous looping (fix → verify → repeat) with direct CI integration and optional auto-merge. Competitors either suggest fixes for human review or handle only one failure category.

---

## Technical Architecture

greencheck is a TypeScript GitHub Action compiled with ncc, running on Node.js 20, with a multi-pass loop orchestrator at its core.

### High-Level Flow

| Step | Component | Description |
|------|-----------|-------------|
| 1. Trigger | workflow_run handler | Fires when any monitored workflow completes with failure status |
| 2. Log Ingest | log-reader.ts | Downloads CI logs via GitHub API, parses into structured failure objects (file, line, error type, message) |
| 3. Triage | triage.ts | Classifies failures: lint, type-error, test-failure, build-error, runtime-error. Prioritizes by fixability. |
| 4. Fix | agent.ts | Routes to CLI agent (`claude` or `codex`) via SDK mode or CLI fallback. Agent receives failure context + source files and produces a patch. |
| 5. Apply | git-ops.ts | Applies patch as atomic commit on the working branch. One commit per failure cluster. |
| 6. Re-run | ci-trigger.ts | Re-triggers the failed workflow via GitHub API. Waits for completion. |
| 7. Evaluate | loop.ts | Reads new CI result. If still failing, loops back to step 2 with updated logs. If green, exits. |
| 8. Report | report.ts | Posts PR comment with fix summary, before/after logs, commit links. |

### Trigger Architecture

greencheck uses the `workflow_run` event to watch for CI failures. This is the critical design decision that enables it to be a true CI guardian rather than a one-shot fixer.

| Trigger Event | What It Catches | Configuration |
|---------------|-----------------|---------------|
| `on: workflow_run` (completed) | Any monitored workflow failure | List workflow names in config |
| `on: check_suite` (completed) | External CI systems (CircleCI, etc.) | Fallback for non-Actions CI |
| `on: issue_comment` (/greencheck) | Manual invocation via comment | Slash command in PR comments |

**Critical constraint:** `workflow_run` events fire on the default branch. greencheck must check out the failing branch, apply fixes there, and push back. The `GITHUB_TOKEN` cannot trigger further `workflow_run` events, so greencheck uses a GitHub App token or PAT to ensure the re-triggered CI actually runs.

### Agent Architecture

greencheck does not make raw LLM API calls. Instead, it delegates code fixes to the **official CLI agents** — [`claude`](https://github.com/anthropics/claude-code) (Claude Code) and [`codex`](https://github.com/openai/codex) (OpenAI Codex CLI). These are installed at action startup and invoked programmatically.

This is a deliberate architectural choice. Both CLIs are full coding agents with tool use, multi-file editing, test execution, and iterative reasoning built in. Wrapping raw API calls would mean reimplementing all of that. Instead, greencheck is the **orchestration layer** (log parsing, failure triage, CI re-triggering, the fix loop) and the agents are the **execution layer** (understanding code, writing patches).

#### CLI Installation

At action startup, greencheck installs the selected agent CLI:

| Agent | Install Command | Version Pinning |
|-------|----------------|-----------------|
| Claude Code | `npm install -g @anthropic-ai/claude-code@latest` | Pinned in action lockfile |
| Codex CLI | `npm install -g @openai/codex@latest` | Pinned in action lockfile |

#### Authentication Flow

Both agents support dual authentication — API key (for direct billing) and OAuth (for org/subscription billing).

| Method | Claude Code | Codex CLI |
|--------|------------|-----------|
| **API Key** | `ANTHROPIC_API_KEY` env var | `OPENAI_API_KEY` env var |
| **OAuth Token** | `CLAUDE_CODE_OAUTH_TOKEN` env var | `codex login --with-api-key` via stdin pipe |
| **Setup** | Just set the env var; CLI reads it automatically | Just set the env var; CLI reads it automatically |

greencheck sets the appropriate environment variable before spawning the agent process. The agent handles all authentication handshakes, token refresh, and API routing internally.

**OAuth is recommended for organizations** that want to use existing Claude Pro/Max/Team subscriptions or OpenAI org billing without distributing raw API keys to CI. Users generate a token once via `claude setup-token` or `codex login --device-auth` and store it as a GitHub Actions secret.

#### Invocation Modes

greencheck invokes agents in two modes, with automatic fallback:

**SDK Mode (preferred):** The agent is spawned as a subprocess that streams JSONL events. greencheck reads these events in real-time for progress tracking, tool use introspection, and structured output parsing. This enables greencheck to monitor what the agent is doing (which files it's reading, which tools it's calling) and abort early if the agent goes off-track.

```
claude --sdk --prompt-file /tmp/fix-prompt.md --max-turns 20 --model claude-sonnet-4-20250514
codex exec --prompt-file /tmp/fix-prompt.md --model codex-mini
```

**CLI Mode (fallback):** If SDK streaming fails (exit code 2 or connection error), greencheck falls back to direct CLI invocation with stdout capture. Less visibility into the agent's internal state, but still produces the same output.

#### Prompt Construction

The agent receives a focused, structured prompt containing:

1. **Failure context:** Parsed CI log output — the exact error messages, file paths, line numbers
2. **Source files:** The relevant source files (only those referenced in the failure, plus direct imports)
3. **Constraints:** Explicit instructions on scope — "Fix only the errors listed. Do not modify any other files. Do not refactor."
4. **Verification command:** The test/lint command to run locally before producing output (when the runner has the right toolchain)

Example prompt structure:
```
Fix the following CI failures. Make minimal changes. Do not modify files not listed.

## Failures

1. ESLint error `no-unused-vars` at src/auth.ts:47 — `'token' is defined but never used`
2. TypeScript error TS2345 at src/auth.ts:52 — Argument of type 'string | undefined' is not assignable to parameter of type 'string'

## Files
[contents of src/auth.ts]

## Constraints
- Fix only the errors listed above
- Do not add new dependencies
- Do not refactor unrelated code
```

#### Agent Output Parsing

greencheck parses the agent's output to extract the actual file changes:

1. **SDK mode:** Reads `tool_use` events for file write operations; extracts file paths and new content directly from the event stream
2. **CLI mode:** Runs `git diff` after the agent exits to capture what changed
3. **Validation:** Confirms the agent only modified files referenced in the failure context. If it touched other files, those changes are discarded.

### Log Parsing Engine

The log parser is the most critical component. Raw CI logs are noisy (thousands of lines of setup, dependency installation, ANSI codes). greencheck must extract the signal.

| Parser | Pattern | Extracted Data |
|--------|---------|----------------|
| ESLint / Biome | `file:line:col: error [rule-id]` | File path, line, rule, message |
| TypeScript (tsc) | `file.ts(line,col): error TSxxxx` | File path, line, TS error code, message |
| Jest / Vitest | `FAIL src/file.test.ts` + stack trace | Test file, test name, assertion, expected vs actual |
| Pytest | `FAILED test_file.py::test_name` | Test file, function, assertion message, traceback |
| Go test | `--- FAIL: TestName (0.00s)` | Package, test name, assertion, file:line |
| Rust (cargo) | `error[E0xxx]: message` | Error code, file, line, span, message |
| Build errors | Various compiler outputs | File, line, error type, message |

Each parser outputs a structured `FailureRecord`: `{ type, file, line, message, rawLog, confidence }`. The confidence score (0–1) indicates how reliably the parser extracted the information. Low-confidence failures are sent to the LLM with more surrounding log context.

### Fix Strategy by Failure Type

| Failure Type | Strategy | Typical Fix | Risk |
|-------------|----------|-------------|------|
| Lint (formatting) | Deterministic first, LLM fallback | Run `linter --fix`, commit result | Very low |
| Lint (logical rules) | LLM with rule docs | Code change guided by rule description | Low |
| Type errors | LLM with type context | Add types, fix signatures, update interfaces | Medium |
| Test failures (assertion) | LLM with test + source | Fix source code to match test expectation | Medium |
| Test failures (snapshot) | Deterministic | Update snapshots via test runner | Low |
| Build errors (dependency) | Deterministic + LLM | Install missing deps, fix import paths | Low |
| Build errors (compilation) | LLM with compiler output | Fix syntax, resolve conflicts | Medium |
| Runtime errors | LLM with stack trace | Fix null refs, async issues, env vars | High |

**Deterministic-first philosophy:** For failures with known automated fixes (`lint --fix`, snapshot updates), greencheck runs the tool directly instead of burning LLM tokens. The LLM is only invoked when the fix requires reasoning about code semantics.

### The Fix Loop

The loop is the heart of greencheck and what separates it from every competitor.

| Parameter | Default | Description |
|-----------|---------|-------------|
| max-passes | 5 | Maximum fix → verify cycles before giving up |
| max-cost | $3.00 | Hard spending limit per run (LLM API costs) |
| timeout | 20m | Total wall-clock time budget |
| cooldown | 30s | Wait between CI re-trigger and log check |
| ci-timeout | 10m | Max time to wait for CI to complete per pass |

Each pass: (1) read latest CI logs, (2) parse failures, (3) cluster by file/type, (4) generate fixes, (5) commit and push, (6) re-trigger CI, (7) wait for result, (8) evaluate. If new failures appear (fix caused a regression), greencheck reverts the offending commit and tries a different approach.

### Git Operations & Safety

- **Atomic commits:** One commit per failure cluster. Each commit message references the CI log and failure type.
- **Branch strategy:** Pushes directly to the failing branch (feature branch). Never pushes to main/master directly.
- **Revert capability:** If a fix introduces new failures, greencheck reverts the commit before trying again.
- **Protected branch respect:** greencheck never force-pushes. It only appends commits to the branch that triggered the failure.

### CI Visibility & Cross-Workflow Access

greencheck has full visibility into all CI activity on a repository.

| Capability | API | Token Required |
|-----------|-----|----------------|
| List all workflow runs for a commit | `GET /repos/{owner}/{repo}/actions/runs` | GITHUB_TOKEN (actions: read) |
| Download logs from any workflow run | `GET /repos/{owner}/{repo}/actions/runs/{id}/logs` | GITHUB_TOKEN (actions: read) |
| List check runs for a commit/ref | `GET /repos/{owner}/{repo}/commits/{ref}/check-runs` | GITHUB_TOKEN (checks: read) |
| Re-run a failed workflow | `POST /repos/{owner}/{repo}/actions/runs/{id}/rerun-failed-jobs` | PAT or GitHub App token |
| Re-run specific job | `POST /repos/{owner}/{repo}/actions/jobs/{id}/rerun` | PAT or GitHub App token |
| Download artifacts from other runs | `GET /repos/{owner}/{repo}/actions/runs/{id}/artifacts` | GITHUB_TOKEN (actions: read) |
| Trigger workflow via dispatch | `POST /repos/{owner}/{repo}/actions/workflows/{id}/dispatches` | PAT or GitHub App token |

**Token strategy:** greencheck requires two tokens: (1) the default `GITHUB_TOKEN` for read operations (logs, check status, artifacts), and (2) a PAT or GitHub App installation token for write operations (re-triggering workflows, pushing commits that trigger further CI). This dual-token approach is necessary because `GITHUB_TOKEN` cannot trigger downstream workflows.

### Auto-Merge Capability

Auto-merge is opt-in with strict safety guardrails. When enabled, greencheck can merge a PR after it achieves green CI — but only under specific conditions.

| Condition | Requirement |
|-----------|-------------|
| auto-merge config | Explicitly enabled in `.greencheck.yml` (default: off) |
| Branch type | Feature branches only. Never main/master/develop. |
| Required reviews | All required PR reviews must already be approved |
| All checks pass | Every required status check must be green, not just the fixed one |
| Fix scope | greencheck only touched files that were already in the PR diff |
| Max commits | greencheck added fewer than `max-auto-merge-commits` (default: 3) |
| Label guard | PR must have a `greencheck:auto-merge` label (added by user) |

If any condition is unmet, greencheck posts a PR comment with the fix summary and leaves merge to the developer.

---

## Configuration

greencheck is configured via `.greencheck.yml` in the repository root, with action inputs as overrides. Defaults < repo config < explicit inputs.

### Action Inputs

| Input | Type | Default | Description |
|-------|------|---------|-------------|
| agent | string | claude | CLI agent to use: `claude` or `codex` |
| agent-api-key | string | — | API key for the agent (`ANTHROPIC_API_KEY` or `OPENAI_API_KEY`) |
| agent-oauth-token | string | — | OAuth token (alternative to API key; e.g. `CLAUDE_CODE_OAUTH_TOKEN`) |
| github-token | string | (required) | Token with actions:read, contents:write |
| trigger-token | string | (required) | PAT or App token for CI re-triggering |
| max-passes | number | 5 | Maximum fix-verify cycles |
| max-cost | string | $3.00 | Hard spend limit per run |
| timeout | string | 20m | Total wall-clock budget |
| auto-merge | boolean | false | Enable auto-merge after green CI |
| watch-workflows | string | all | Comma-separated workflow names to monitor |
| fix-types | string | all | Failure types to fix: lint, types, tests, build |
| model | string | (agent default) | Override default model for the agent |
| dry-run | boolean | false | Diagnose and report without pushing fixes |

> **Note:** Either `agent-api-key` or `agent-oauth-token` must be provided. OAuth is recommended for organizations using Claude Pro/Max/Team or OpenAI org billing.

### Repository Config (.greencheck.yml)

```yaml
# What to monitor
watch:
  workflows: [ci, tests, lint]     # workflow names to watch (default: all)
  branches: [main, develop]         # branches to monitor (default: all)
  ignore-authors: [dependabot]      # skip failures from these authors

# How to fix
fix:
  agent: claude                     # claude | codex
  model: claude-sonnet-4-20250514           # override default model
  types: [lint, types, tests, build] # failure types to attempt
  max-passes: 5
  max-cost: "$3.00"
  timeout: 20m

# Auto-merge rules
merge:
  enabled: false
  max-commits: 3
  require-label: true               # require greencheck:auto-merge label
  protected-patterns: ["main", "master", "develop", "release/*"]

# Reporting
report:
  pr-comment: true
  job-summary: true
  slack-webhook: ""                 # optional Slack notification URL

# Safety guardrails
safety:
  never-touch-files: ["*.lock", "package-lock.json", ".env*"]
  max-files-per-fix: 10
  revert-on-regression: true
```

---

## Module Map

| Module | Purpose |
|--------|---------|
| index.ts | Entry point, config loading, orchestration |
| loop.ts | Multi-pass fix → verify cycle |
| log-reader.ts | CI log download and structured parsing |
| triage.ts | Failure classification and prioritization |
| agent.ts | CLI agent routing (`claude`/`codex` SDK + CLI fallback) |
| git-ops.ts | Commit, push, branch management, revert |
| ci-trigger.ts | Re-run workflows, wait for completion |
| report.ts | PR comments, job summaries, Slack notifications |
| config.ts | Config loading, validation, merging |
| parsers/*.ts | Per-language log parsers (eslint, tsc, jest, pytest, go, rust) |
| types.ts | TypeScript interfaces and enums |
| checkpoint.ts | State persistence across chained runs |

---

## GitHub Actions Constraints

Hard platform constraints that shape the architecture.

| Constraint | Limit | Mitigation |
|-----------|-------|------------|
| Job timeout | 6 hours max | Workflow chaining via dispatch |
| GITHUB_TOKEN can't trigger workflows | By design | Dual-token: GITHUB_TOKEN + PAT/App token |
| API rate limit | 5,000 req/hour (authenticated) | Batch log downloads, cache parsed results |
| Log download URL expiry | 1 minute | Download immediately, parse locally |
| No real-time log streaming | Logs available after job completes | Poll with exponential backoff |
| Protected branch push | Requires admin or bypass | Push to feature branch only, never main |

---

## Success Metrics

| Metric | Target | How Measured |
|--------|--------|--------------|
| Fix rate | >70% of fixable failures resolved | Failures fixed / total failures attempted |
| Loop efficiency | <3 passes average to green | Average passes per successful run |
| Time to green | <10 min average | Wall clock from trigger to passing CI |
| Regression rate | <5% of fixes cause new failures | Reverts / total fix commits |
| Cost per fix | <$0.50 average | LLM API spend / fixes applied |

---

## Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| LLM generates incorrect fix that passes CI | High | Atomic commits for easy revert; never-touch-files config; scope limits |
| Infinite loop (fix creates new failure) | Medium | Regression detection with auto-revert; max-passes hard limit; cost ceiling |
| Token/API cost runaway | Medium | Hard max-cost limit; budget tracking per run; alert on >80% spend |
| GitHub Actions outage during fix loop | Low | Checkpoint system; graceful resume on re-trigger |
| Flaky test false positive | Medium | Re-run failed tests before attempting fix; flaky test detection heuristic |

---

## Roadmap

| Phase | Scope | Timeline |
|-------|-------|----------|
| v0.1 — Foundation | Log parsing (ESLint, tsc, Jest), single-pass fix, PR comment reporting | 4 weeks |
| v0.2 — Loop | Multi-pass fix-verify cycle, regression detection, revert capability | 3 weeks |
| v0.3 — Breadth | Additional parsers (pytest, Go, Rust), deterministic-first fixes | 3 weeks |
| v0.4 — Auto-merge | Opt-in auto-merge with full safety guardrails | 2 weeks |
| v0.5 — Polish | Slack integration, dashboard, badge system, config wizard | 2 weeks |
| v1.0 — Launch | Public release, documentation, marketplace listing | 2 weeks |
