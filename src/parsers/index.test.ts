import { describe, expect, it } from 'vitest';
import { parseLog } from './index';

describe('parseLog', () => {
  it('detects and parses ESLint + TypeScript in the same log', () => {
    const log = `
> eslint src/
src/auth.ts:47:7: error 'token' is defined but never used  no-unused-vars

> tsc --noEmit
src/types.ts(10,3): error TS2304: Cannot find name 'MyType'.
    `.trim();

    const result = parseLog(log);
    expect(result.failures).toHaveLength(2);
    expect(result.failures.some((failure) => failure.type === 'lint')).toBe(true);
    expect(result.failures.some((failure) => failure.type === 'type-error')).toBe(true);
    expect(result.parserUsed).toContain('eslint');
    expect(result.parserUsed).toContain('typescript');
  });

  it('detects Biome output', () => {
    const log = `
src/app.ts:12:4 lint/style/useConst ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  This let declares a variable that is never reassigned.
    `.trim();

    const result = parseLog(log);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatchObject({
      type: 'lint',
      file: 'src/app.ts',
      rule: 'lint/style/useConst',
    });
    expect(result.parserUsed).toContain('eslint');
  });

  it('detects Go compiler output', () => {
    const log = './pkg/service.go:14:2: undefined: handler';
    const result = parseLog(log);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatchObject({
      type: 'build-error',
      file: 'pkg/service.go',
      line: 14,
      column: 2,
    });
    expect(result.parserUsed).toContain('go');
  });

  it('strips ANSI codes', () => {
    const log = '\x1B[31msrc/a.ts(1,1): error TS2304: bad\x1B[0m';
    const result = parseLog(log);
    expect(result.failures).toHaveLength(1);
  });

  it('deduplicates identical failures', () => {
    const log = `
src/a.ts(1,1): error TS2304: Cannot find name 'x'.
src/a.ts(1,1): error TS2304: Cannot find name 'x'.
    `.trim();
    const result = parseLog(log);
    expect(result.failures).toHaveLength(1);
  });

  it('returns empty for clean log', () => {
    const result = parseLog('All checks passed. No errors.');
    expect(result.failures).toHaveLength(0);
    expect(result.parserUsed).toBe('none');
  });
});
