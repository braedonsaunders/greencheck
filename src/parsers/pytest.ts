import { FailureRecord } from '../types';

// FAILED test_file.py::TestClass::test_name - AssertionError: message
const FAILED_PATTERN = /^FAILED\s+(.+?)::(.+?)(?:\s+-\s+(.+))?$/;
// E       AssertionError: ...
const ASSERTION_PATTERN = /^E\s+(.+)$/;
// file.py:42: in function_name
const LOCATION_PATTERN = /^(.+?):(\d+):\s+in\s+/;
// short test summary info section
const SUMMARY_START = /^=+\s+short test summary info\s+=+$/;
// error collection
const ERROR_PATTERN = /^ERROR\s+(.+?)(?:\s+-\s+(.+))?$/;

export function parsePytest(log: string): FailureRecord[] {
  const failures: FailureRecord[] = [];
  const lines = log.split('\n');
  let inSummary = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (SUMMARY_START.test(line)) {
      inSummary = true;
      continue;
    }

    if (inSummary) {
      const failMatch = line.match(FAILED_PATTERN);
      if (failMatch) {
        const [, filePath, testName, errorMsg] = failMatch;
        const file = filePath.split('::')[0];

        // Scan backwards for location and assertion details
        let detailedMsg = errorMsg || `Test failed: ${testName}`;
        let lineNum: number | null = null;
        const rawLines: string[] = [line];

        for (let j = i - 1; j >= Math.max(0, i - 50); j--) {
          const prevLine = lines[j].trim();
          const locMatch = prevLine.match(LOCATION_PATTERN);
          if (locMatch && locMatch[1].includes(file)) {
            lineNum = parseInt(locMatch[2], 10);
            break;
          }
          const assertMatch = prevLine.match(ASSERTION_PATTERN);
          if (assertMatch && detailedMsg === `Test failed: ${testName}`) {
            detailedMsg = assertMatch[1].trim();
          }
        }

        failures.push({
          type: 'test-failure',
          file,
          line: lineNum,
          column: null,
          message: detailedMsg,
          rule: null,
          rawLog: rawLines.join('\n'),
          confidence: lineNum ? 0.85 : 0.7,
        });
      }

      const errorMatch = line.match(ERROR_PATTERN);
      if (errorMatch) {
        failures.push({
          type: 'test-failure',
          file: errorMatch[1].split('::')[0],
          line: null,
          column: null,
          message: errorMatch[2] || `Collection error: ${errorMatch[1]}`,
          rule: null,
          rawLog: line,
          confidence: 0.7,
        });
      }
    }
  }

  return failures;
}
