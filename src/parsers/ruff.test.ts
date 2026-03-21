import { describe, expect, it } from 'vitest';
import { parseRuff } from './ruff';

describe('parseRuff', () => {
  it('parses Ruff diagnostics with a following location line', () => {
    const log = `
F841 Local variable \`children\` is assigned to but never used
   --> services/ai/openui_formatter.py:138:5
    |
136 |     pnl_str = f"$\{daily_pnl:+.2f}"
    `.trim();

    const failures = parseRuff(log);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      type: 'lint',
      file: 'services/ai/openui_formatter.py',
      line: 138,
      column: 5,
      rule: 'F841',
    });
  });

  it('ignores incomplete diagnostics without a concrete location', () => {
    const log = 'F541 f-string without any placeholders';
    expect(parseRuff(log)).toHaveLength(0);
  });
});
