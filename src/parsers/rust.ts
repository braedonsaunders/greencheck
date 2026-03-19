import { FailureRecord } from '../types';

const ERROR_CODE_PATTERN = /^error\[(E\d+)\]:\s+(.+)$/;
const ERROR_PLAIN_PATTERN = /^error:\s+(.+)$/;
const LOCATION_PATTERN = /^\s*-->\s+(.+?):(\d+):(\d+)$/;
const PANIC_PATTERN = /^thread\s+'(.+?)'\s+panicked\s+at\s+'(.+?)',\s+(.+?):(\d+):(\d+)$/;

export function parseRust(log: string): FailureRecord[] {
  const failures: FailureRecord[] = [];
  const lines = log.split('\n');

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    const codeMatch = line.match(ERROR_CODE_PATTERN);
    if (codeMatch) {
      const [, code, message] = codeMatch;
      let file = '';
      let lineNum: number | null = null;
      let column: number | null = null;
      const rawLines = [line];

      for (let scanIndex = index + 1; scanIndex < Math.min(index + 10, lines.length); scanIndex++) {
        const nextLine = lines[scanIndex].trim();
        rawLines.push(nextLine);

        const locationMatch = nextLine.match(LOCATION_PATTERN);
        if (locationMatch) {
          file = locationMatch[1];
          lineNum = Number.parseInt(locationMatch[2], 10);
          column = Number.parseInt(locationMatch[3], 10);
          break;
        }
      }

      if (file) {
        failures.push({
          type: 'build-error',
          file,
          line: lineNum,
          column,
          message: `${code}: ${message}`,
          rule: code,
          rawLog: rawLines.join('\n'),
          confidence: 0.95,
        });
      }

      continue;
    }

    const panicMatch = line.match(PANIC_PATTERN);
    if (panicMatch) {
      const [, testName, message, file, lineNum, column] = panicMatch;
      failures.push({
        type: 'test-failure',
        file,
        line: Number.parseInt(lineNum, 10),
        column: Number.parseInt(column, 10),
        message: `${testName}: ${message}`,
        rule: null,
        rawLog: line,
        confidence: 0.9,
      });
      continue;
    }

    const plainMatch = line.match(ERROR_PLAIN_PATTERN);
    if (!plainMatch || line.includes('aborting due to')) {
      continue;
    }

    let file = '';
    let lineNum: number | null = null;
    let column: number | null = null;

    for (let scanIndex = index + 1; scanIndex < Math.min(index + 10, lines.length); scanIndex++) {
      const nextLine = lines[scanIndex].trim();
      const locationMatch = nextLine.match(LOCATION_PATTERN);
      if (locationMatch) {
        file = locationMatch[1];
        lineNum = Number.parseInt(locationMatch[2], 10);
        column = Number.parseInt(locationMatch[3], 10);
        break;
      }
    }

    if (file) {
      failures.push({
        type: 'build-error',
        file,
        line: lineNum,
        column,
        message: plainMatch[1],
        rule: null,
        rawLog: line,
        confidence: 0.8,
      });
    }
  }

  return failures;
}
