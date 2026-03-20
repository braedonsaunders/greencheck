# Contributing to greencheck

Thanks for your interest in contributing! Here's how to get started.

## Development Setup

```bash
git clone https://github.com/braedonsaunders/greencheck.git
cd greencheck
npm install
```

## Development Workflow

1. Create a feature branch from `main`
2. Make your changes in `src/`
3. Run the checks:

```bash
npm test          # run tests (vitest)
npm run lint      # eslint
npm run typecheck # tsc --noEmit
npm run build     # ncc bundle
```

4. Commit your changes including the updated `dist/` folder
5. Open a pull request against `main`

## Project Structure

```
src/
  index.ts          Entry point (GitHub Action)
  types.ts          Shared TypeScript types
  config.ts         Config loading (inputs + .greencheck.yml)
  agent.ts          Claude Code / Codex invocation
  loop.ts           Fix/verify cycle orchestration
  triage.ts         Failure clustering and prioritization
  log-reader.ts     CI log download and processing
  git-ops.ts        Git commit, push, revert operations
  report.ts         PR comments, job summaries, Slack
  checkpoint.ts     State persistence across re-runs
  ci-trigger.ts     Workflow re-run and polling
  glob.ts           Glob pattern matching
  parsers/          Language-specific log parsers
    eslint.ts       ESLint and Biome
    typescript.ts   TypeScript compiler
    jest.ts         Jest and Vitest
    pytest.ts       Pytest
    go.ts           Go test and compiler
    rust.ts         Rust compiler and cargo test
```

## Adding a New Parser

1. Create `src/parsers/<language>.ts` exporting a `parse<Language>(log: string): FailureRecord[]` function
2. Register it in `src/parsers/index.ts` with a `detect` function and name
3. Add tests in `src/parsers/<language>.test.ts`
4. Re-export it from `src/parsers/index.ts`

## Guidelines

- Keep changes small and focused
- Add tests for new features
- Update the README if adding user-facing features
- Don't modify `package-lock.json` unless adding/removing dependencies

## Reporting Issues

Please use GitHub Issues. Include:
- The CI log output that greencheck failed to parse (if applicable)
- Your `.greencheck.yml` config
- The workflow YAML you're using
