import { FailureRecord } from '../types';

const FAIL_SUITE_PATTERN = /^\s*FAIL\s+(.+\.(?:test|spec)\.\w+)/;
const TEST_NAME_PATTERN = /^\s*\u25cf\s+(.+)$/;
const EXPECTED_PATTERN = /^\s*Expected:\s+(.+)$/;
const RECEIVED_PATTERN = /^\s*Received:\s+(.+)$/;
const STACK_PATTERN = /at\s+.+\((.+?):(\d+):(\d+)\)/;
const SNAPSHOT_PATTERN = /^\s*\u203a\s+(\d+)\s+snapshot(?:s)?\s+failed/;

export function parseJest(log: string): FailureRecord[] {
  const failures: FailureRecord[] = [];
  const lines = log.split('\n');
  let currentSuite: string | null = null;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];

    const suiteMatch = line.match(FAIL_SUITE_PATTERN);
    if (suiteMatch) {
      currentSuite = suiteMatch[1].trim();
      continue;
    }

    const testMatch = line.match(TEST_NAME_PATTERN);
    if (testMatch && currentSuite) {
      const testName = testMatch[1].trim();
      let message = `Test failed: ${testName}`;
      let file = currentSuite;
      let lineNum: number | null = null;
      let column: number | null = null;
      const rawLines = [line];
      let expected: string | null = null;
      let received: string | null = null;

      for (let scanIndex = index + 1; scanIndex < lines.length && scanIndex < index + 30; scanIndex++) {
        const nextLine = lines[scanIndex];
        rawLines.push(nextLine);

        const expectedMatch = nextLine.match(EXPECTED_PATTERN);
        if (expectedMatch) {
          expected = expectedMatch[1].trim();
        }

        const receivedMatch = nextLine.match(RECEIVED_PATTERN);
        if (receivedMatch) {
          received = receivedMatch[1].trim();
        }

        const stackMatch = nextLine.match(STACK_PATTERN);
        if (stackMatch && !lineNum) {
          file = stackMatch[1].trim();
          lineNum = Number.parseInt(stackMatch[2], 10);
          column = Number.parseInt(stackMatch[3], 10);
        }

        if (
          scanIndex > index + 1 &&
          (nextLine.match(TEST_NAME_PATTERN) || nextLine.match(FAIL_SUITE_PATTERN))
        ) {
          break;
        }
      }

      if (expected && received) {
        message = `${testName}: Expected ${expected}, Received ${received}`;
      }

      failures.push({
        type: 'test-failure',
        file,
        line: lineNum,
        column,
        message,
        rule: null,
        rawLog: rawLines.join('\n'),
        confidence: lineNum ? 0.9 : 0.7,
      });
    }

    const snapshotMatch = line.match(SNAPSHOT_PATTERN);
    if (snapshotMatch && currentSuite) {
      failures.push({
        type: 'test-failure',
        file: currentSuite,
        line: null,
        column: null,
        message: `${snapshotMatch[1]} snapshot(s) failed - run the test runner with --update`,
        rule: 'snapshot',
        rawLog: line,
        confidence: 0.95,
      });
    }
  }

  return failures;
}
