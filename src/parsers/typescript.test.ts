import { describe, it, expect } from 'vitest';
import { parseTypeScript } from './typescript';

describe('parseTypeScript', () => {
  it('parses tsc parenthesis format', () => {
    const log = `
src/auth.ts(52,10): error TS2345: Argument of type 'string | undefined' is not assignable to parameter of type 'string'.
src/types.ts(10,3): error TS2304: Cannot find name 'MyInterface'.
    `.trim();

    const failures = parseTypeScript(log);
    expect(failures).toHaveLength(2);
    expect(failures[0]).toMatchObject({
      type: 'type-error',
      file: 'src/auth.ts',
      line: 52,
      column: 10,
      rule: 'TS2345',
    });
    expect(failures[1]).toMatchObject({
      type: 'type-error',
      file: 'src/types.ts',
      line: 10,
      rule: 'TS2304',
    });
  });

  it('parses tsc colon format', () => {
    const log = `src/index.ts:5:3 - error TS7006: Parameter 'x' implicitly has an 'any' type.`;
    const failures = parseTypeScript(log);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      type: 'type-error',
      file: 'src/index.ts',
      line: 5,
      column: 3,
      rule: 'TS7006',
    });
  });

  it('handles empty log', () => {
    expect(parseTypeScript('')).toHaveLength(0);
  });

  it('handles multiple errors in the same file', () => {
    const log = `
src/api.ts(1,1): error TS2304: Cannot find name 'Foo'.
src/api.ts(5,10): error TS2304: Cannot find name 'Bar'.
src/api.ts(12,3): error TS2345: Argument type mismatch.
    `.trim();

    const failures = parseTypeScript(log);
    expect(failures).toHaveLength(3);
    expect(failures.every((f) => f.file === 'src/api.ts')).toBe(true);
  });

  it('handles mixed parenthesis and colon formats', () => {
    const log = `
src/a.ts(1,1): error TS2304: Cannot find name 'X'.
src/b.ts:2:3 - error TS2345: Type mismatch.
    `.trim();

    const failures = parseTypeScript(log);
    expect(failures).toHaveLength(2);
    expect(failures[0].file).toBe('src/a.ts');
    expect(failures[1].file).toBe('src/b.ts');
  });

  it('ignores non-error lines mixed with errors', () => {
    const log = `
Found 2 errors in 1 file.
src/index.ts(10,5): error TS2304: Cannot find name 'test'.
Errors  Files
     2  src/index.ts
    `.trim();

    const failures = parseTypeScript(log);
    expect(failures).toHaveLength(1);
    expect(failures[0].line).toBe(10);
  });

  it('handles Windows-style paths in parenthesis format', () => {
    const log = `src\\utils\\helper.ts(5,3): error TS2304: Cannot find name 'foo'.`;
    const failures = parseTypeScript(log);
    expect(failures).toHaveLength(1);
    expect(failures[0].file).toBe('src\\utils\\helper.ts');
  });

  it('preserves full error message with TS code', () => {
    const log = `src/a.ts(1,1): error TS2322: Type 'string' is not assignable to type 'number'.`;
    const failures = parseTypeScript(log);
    expect(failures[0].message).toContain('TS2322');
    expect(failures[0].message).toContain('not assignable');
  });
});
