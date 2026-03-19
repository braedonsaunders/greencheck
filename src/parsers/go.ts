import { FailureRecord } from '../types';

const FAIL_TEST_PATTERN = /^---\s+FAIL:\s+(\S+)\s+\([\d.]+s\)$/;
const GO_ERROR_PATTERN = /^(\S+\.go):(\d+):\s+(.+)$/;
const COMPILE_PATTERN = /^\.?\/?([\w/.-]+\.go):(\d+):(\d+):\s+(.+)$/;

export function parseGo(log: string): FailureRecord[] {
  const failures: FailureRecord[] = [];
  const lines = log.split('\n');

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    const testMatch = line.match(FAIL_TEST_PATTERN);
    if (testMatch) {
      const testName = testMatch[1];
      let file = '';
      let lineNum: number | null = null;
      let message = `Test failed: ${testName}`;
      const rawLines = [line];

      for (let scanIndex = index - 1; scanIndex >= Math.max(0, index - 20); scanIndex--) {
        const previousLine = lines[scanIndex].trim();
        rawLines.unshift(previousLine);

        const errorMatch = previousLine.match(GO_ERROR_PATTERN);
        if (errorMatch) {
          file = errorMatch[1];
          lineNum = Number.parseInt(errorMatch[2], 10);
          message = `${testName}: ${errorMatch[3].trim()}`;
          break;
        }
      }

      if (file) {
        failures.push({
          type: 'test-failure',
          file,
          line: lineNum,
          column: null,
          message,
          rule: null,
          rawLog: rawLines.join('\n'),
          confidence: 0.9,
        });
      }

      continue;
    }

    const compileMatch = line.match(COMPILE_PATTERN);
    if (compileMatch && !line.startsWith('---') && !line.startsWith('===')) {
      const [, file, lineNum, column, message] = compileMatch;
      failures.push({
        type: 'build-error',
        file,
        line: Number.parseInt(lineNum, 10),
        column: Number.parseInt(column, 10),
        message: message.trim(),
        rule: null,
        rawLog: line,
        confidence: 0.9,
      });
    }
  }

  return failures;
}
