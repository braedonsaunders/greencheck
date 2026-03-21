import { FailureRecord } from '../types';

const RUFF_DIAGNOSTIC_PATTERN = /^([A-Z]\d{3,4})\s+(.+)$/;
const LOCATION_PATTERN = /^\s*-->\s+(.+?):(\d+):(\d+)$/;

export function parseRuff(log: string): FailureRecord[] {
  const failures: FailureRecord[] = [];
  const lines = log.split('\n');

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    const diagnosticMatch = line.match(RUFF_DIAGNOSTIC_PATTERN);
    if (!diagnosticMatch) {
      continue;
    }

    const [, rule, message] = diagnosticMatch;
    let file = '';
    let lineNum: number | null = null;
    let column: number | null = null;
    const rawLines = [line];

    for (let scanIndex = index + 1; scanIndex < Math.min(index + 8, lines.length); scanIndex++) {
      const nextLine = lines[scanIndex];
      rawLines.push(nextLine);

      const locationMatch = nextLine.match(LOCATION_PATTERN);
      if (locationMatch) {
        file = locationMatch[1].trim();
        lineNum = Number.parseInt(locationMatch[2], 10);
        column = Number.parseInt(locationMatch[3], 10);
        break;
      }
    }

    if (!file) {
      continue;
    }

    failures.push({
      type: 'lint',
      file,
      line: lineNum,
      column,
      message: message.trim(),
      rule,
      rawLog: rawLines.join('\n'),
      confidence: 0.95,
    });
  }

  return failures;
}
