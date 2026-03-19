import { FailureRecord } from '../types';

// Matches: src/file.ts(10,5): error TS2345: message
const TSC_PATTERN = /^(.+?)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.+)$/;
// Alternative format: src/file.ts:10:5 - error TS2345: message
const TSC_ALT_PATTERN = /^(.+?):(\d+):(\d+)\s+-\s+error\s+(TS\d+):\s+(.+)$/;

export function parseTypeScript(log: string): FailureRecord[] {
  const failures: FailureRecord[] = [];
  const lines = log.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    const match = trimmed.match(TSC_PATTERN) || trimmed.match(TSC_ALT_PATTERN);
    if (match) {
      const [, file, lineNum, col, code, message] = match;
      failures.push({
        type: 'type-error',
        file: file.trim(),
        line: parseInt(lineNum, 10),
        column: parseInt(col, 10),
        message: `${code}: ${message.trim()}`,
        rule: code,
        rawLog: trimmed,
        confidence: 0.95,
      });
    }
  }

  return failures;
}
