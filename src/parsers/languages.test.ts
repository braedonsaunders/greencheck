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

  it('parses multiple pytest failures', () => {
    const log = `
=========================== short test summary info ===========================
FAILED tests/test_a.py::test_one - AssertionError: 1 != 2
FAILED tests/test_a.py::test_two - ValueError: invalid
FAILED tests/test_b.py::TestClass::test_method - TypeError: bad type
    `.trim();

    const failures = parsePytest(log);
    expect(failures).toHaveLength(3);
    expect(failures[0].file).toBe('tests/test_a.py');
    expect(failures[2].file).toBe('tests/test_b.py');
  });

  it('parses pytest collection errors', () => {
    const log = `
=========================== short test summary info ===========================
ERROR tests/test_broken.py - SyntaxError: invalid syntax
    `.trim();

    const failures = parsePytest(log);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      type: 'test-failure',
      file: 'tests/test_broken.py',
    });
    expect(failures[0].message).toContain('SyntaxError');
  });

  it('handles parametrized test names', () => {
    const log = `
=========================== short test summary info ===========================
FAILED tests/test_math.py::test_add[1-2-3] - AssertionError
FAILED tests/test_math.py::test_add[0-0-1] - AssertionError
    `.trim();

    const failures = parsePytest(log);
    expect(failures).toHaveLength(2);
  });

  it('handles empty log', () => {
    expect(parsePytest('')).toHaveLength(0);
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

  it('parses go compiler errors', () => {
    const log = `./pkg/service.go:14:2: undefined: handler`;
    const failures = parseGo(log);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      type: 'build-error',
      file: 'pkg/service.go',
      line: 14,
      column: 2,
    });
  });

  it('parses multiple go compiler errors', () => {
    const log = `
./main.go:10:2: undefined: foo
./main.go:15:5: cannot use x (type string) as type int
./pkg/util.go:3:2: imported and not used: "fmt"
    `.trim();

    const failures = parseGo(log);
    expect(failures).toHaveLength(3);
    expect(failures[0].file).toBe('main.go');
    expect(failures[2].file).toBe('pkg/util.go');
  });

  it('handles empty log', () => {
    expect(parseGo('')).toHaveLength(0);
  });

  it('handles test failures without file locations', () => {
    const log = `
--- FAIL: TestSomething (0.05s)
FAIL example.com/pkg 0.123s
    `.trim();

    const failures = parseGo(log);
    // No file location found, so should not create a failure record
    expect(failures).toHaveLength(0);
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

  it('parses multiple rust errors', () => {
    const log = `
error[E0308]: mismatched types
  --> src/main.rs:10:5

error[E0425]: cannot find value \`x\` in this scope
  --> src/lib.rs:20:10
    `.trim();

    const failures = parseRust(log);
    expect(failures).toHaveLength(2);
    expect(failures[0].rule).toBe('E0308');
    expect(failures[1].rule).toBe('E0425');
  });

  it('parses rust panic/test failures', () => {
    const log = `thread 'tests::test_add' panicked at 'assertion failed: 2 == 3', src/lib.rs:15:5`;
    const failures = parseRust(log);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      type: 'test-failure',
      file: 'src/lib.rs',
      line: 15,
      column: 5,
    });
    expect(failures[0].message).toContain('tests::test_add');
  });

  it('parses plain errors without error codes', () => {
    const log = `
error: unused variable: \`x\`
  --> src/main.rs:5:9
    `.trim();

    const failures = parseRust(log);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      type: 'build-error',
      file: 'src/main.rs',
      line: 5,
      rule: null,
    });
  });

  it('ignores aborting messages', () => {
    const log = `
error[E0308]: mismatched types
  --> src/main.rs:10:5

error: aborting due to previous error
    `.trim();

    const failures = parseRust(log);
    expect(failures).toHaveLength(1);
    expect(failures[0].rule).toBe('E0308');
  });

  it('handles empty log', () => {
    expect(parseRust('')).toHaveLength(0);
  });
});
