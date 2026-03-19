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
});
