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
});
