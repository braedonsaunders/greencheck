import { describe, expect, it } from 'vitest';
import { parseJest } from './jest';

describe('parseJest', () => {
  it('parses Jest test failures with unicode markers', () => {
    const log = `
 FAIL src/auth.test.ts
  \u25cf Auth > should validate token

    expect(received).toBe(expected)

    Expected: true
    Received: false

      10 |   const result = validateToken(token);
      11 |   expect(result).toBe(true);
         |                  ^
      12 | });

      at Object.<anonymous> (src/auth.test.ts:11:18)
    `.trim();

    const failures = parseJest(log);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      type: 'test-failure',
      file: 'src/auth.test.ts',
      line: 11,
      column: 18,
    });
    expect(failures[0].message).toContain('Expected');
    expect(failures[0].message).toContain('Received');
  });

  it('handles snapshot failures', () => {
    const log = `
 FAIL src/snapshots.test.ts
  \u203a 2 snapshots failed
    `.trim();

    const failures = parseJest(log);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      rule: 'snapshot',
      file: 'src/snapshots.test.ts',
    });
  });

  it('handles empty log', () => {
    expect(parseJest('')).toHaveLength(0);
  });

  it('handles multiple test suites with failures', () => {
    const log = `
 FAIL src/auth.test.ts
  \u25cf should validate token

    Expected: true
    Received: false

      at Object.<anonymous> (src/auth.test.ts:5:10)

 FAIL src/user.test.ts
  \u25cf should create user

    Expected: 201
    Received: 400

      at Object.<anonymous> (src/user.test.ts:12:18)
    `.trim();

    const failures = parseJest(log);
    expect(failures).toHaveLength(2);
    expect(failures[0].file).toBe('src/auth.test.ts');
    expect(failures[1].file).toBe('src/user.test.ts');
  });

  it('handles nested describe blocks in test names', () => {
    const log = `
 FAIL src/api.test.ts
  \u25cf API > Auth > POST /login > should return 200 for valid credentials

    expect(received).toBe(expected)

    Expected: 200
    Received: 401

      at Object.<anonymous> (src/api.test.ts:45:22)
    `.trim();

    const failures = parseJest(log);
    expect(failures).toHaveLength(1);
    expect(failures[0].message).toContain('API > Auth > POST /login');
  });

  it('handles test failures without stack traces', () => {
    const log = `
 FAIL src/simple.test.ts
  \u25cf basic math works
    `.trim();

    const failures = parseJest(log);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      type: 'test-failure',
      file: 'src/simple.test.ts',
      line: null,
    });
    expect(failures[0].confidence).toBe(0.7);
  });

  it('handles vitest-style test file extensions', () => {
    const log = `
 FAIL src/utils.spec.ts
  \u25cf format > should format dates

    Expected: "2024-01-01"
    Received: "01/01/2024"

      at src/utils.spec.ts:8:14
    `.trim();

    const failures = parseJest(log);
    expect(failures).toHaveLength(1);
    expect(failures[0].file).toContain('utils.spec.ts');
  });
});
