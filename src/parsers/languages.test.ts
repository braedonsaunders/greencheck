import { describe, expect, it } from 'vitest';
import { parseGo } from './go';
import { parsePytest } from './pytest';
import { parseRust } from './rust';

describe('parsePytest', () => {
  it('parses pytest short summary failures', () => {
    const log = `
_________________________ test_adds_numbers _________________________

tests/test_math.py:12: in test_adds_numbers
E   AssertionError: assert 3 == 4

=========================== short test summary info ===========================
FAILED tests/test_math.py::test_adds_numbers - AssertionError: assert 3 == 4
    `.trim();

    const failures = parsePytest(log);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      type: 'test-failure',
      file: 'tests/test_math.py',
      line: 12,
      message: 'AssertionError: assert 3 == 4',
    });
  });
});

describe('parseGo', () => {
  it('parses go test failures', () => {
    const log = `
main_test.go:42: expected 2, got 3
--- FAIL: TestAdd (0.00s)
FAIL example.com/math 0.001s
    `.trim();

    const failures = parseGo(log);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      type: 'test-failure',
      file: 'main_test.go',
      line: 42,
      message: 'TestAdd: expected 2, got 3',
    });
  });
});

describe('parseRust', () => {
  it('parses rust compiler errors', () => {
    const log = `
error[E0308]: mismatched types
  --> src/main.rs:10:5
   |
10 |     foo("hi");
   |     ^^^^^^^^^ expected \`u32\`, found \`&str\`
    `.trim();

    const failures = parseRust(log);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      type: 'build-error',
      file: 'src/main.rs',
      line: 10,
      column: 5,
      rule: 'E0308',
    });
  });
});
