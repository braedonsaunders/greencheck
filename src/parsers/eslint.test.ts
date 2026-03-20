import { describe, expect, it } from 'vitest';
import { parseEslint } from './eslint';

describe('parseEslint', () => {
  it('parses standard ESLint errors', () => {
    const log = `
src/auth.ts:47:7: error 'token' is defined but never used  no-unused-vars
src/auth.ts:52:10: error Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
src/utils.ts:10:1: warning Missing return type  @typescript-eslint/explicit-function-return-type
    `.trim();

    const failures = parseEslint(log);
    expect(failures).toHaveLength(2);
    expect(failures[0]).toMatchObject({
      type: 'lint',
      file: 'src/auth.ts',
      line: 47,
      column: 7,
      rule: 'no-unused-vars',
    });
    expect(failures[1]).toMatchObject({
      type: 'lint',
      file: 'src/auth.ts',
      line: 52,
      column: 10,
      rule: '@typescript-eslint/no-explicit-any',
    });
  });

  it('parses Biome output', () => {
    const log = `
src/app.ts:12:4 lint/style/useConst \u2501\u2501\u2501

  This let declares a variable that is never reassigned.
    `.trim();

    const failures = parseEslint(log);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      type: 'lint',
      file: 'src/app.ts',
      line: 12,
      column: 4,
      rule: 'lint/style/useConst',
    });
  });

  it('handles empty log', () => {
    expect(parseEslint('')).toHaveLength(0);
  });

  it('ignores non-ESLint output', () => {
    const log = `
npm install completed
running tests...
all tests passed
    `;
    expect(parseEslint(log)).toHaveLength(0);
  });

  it('only captures errors, not warnings', () => {
    const log = `
src/a.ts:1:1: warning Unexpected console statement  no-console
src/b.ts:2:1: error Missing semicolon  semi
    `.trim();

    const failures = parseEslint(log);
    expect(failures).toHaveLength(1);
    expect(failures[0].file).toBe('src/b.ts');
  });

  it('handles ESLint errors without a rule name', () => {
    const log = 'src/index.ts:10:5: error Parsing error: Unexpected token';
    const failures = parseEslint(log);
    expect(failures).toHaveLength(1);
    expect(failures[0].rule).toBeNull();
    expect(failures[0].confidence).toBe(0.8);
  });

  it('handles multiple Biome diagnostics', () => {
    const log = `
src/a.ts:1:1 lint/correctness/noUnusedVariables \u2501\u2501\u2501

  This variable is declared but never used.

src/b.ts:5:3 lint/style/useConst \u2501\u2501\u2501

  This let declares a variable that is never reassigned.
    `.trim();

    const failures = parseEslint(log);
    expect(failures).toHaveLength(2);
    expect(failures[0].file).toBe('src/a.ts');
    expect(failures[1].file).toBe('src/b.ts');
  });

  it('handles deeply nested file paths', () => {
    const log = 'packages/core/src/utils/helpers/format.ts:100:15: error Unexpected any  @typescript-eslint/no-explicit-any';
    const failures = parseEslint(log);
    expect(failures).toHaveLength(1);
    expect(failures[0].file).toBe('packages/core/src/utils/helpers/format.ts');
  });
});
