import { FailureRecord } from '../types';

const ESLINT_PATTERN = /^(.+?):(\d+):(\d+):\s+(error|warning)\s+(.+?)(?:\s{2,}(\S+))?$/;
const BIOME_PATTERN = /^(.+?):(\d+):(\d+)\s+(lint\/\S+)\s+\u2501+/;

export function parseEslint(log: string): FailureRecord[] {
  const failures: FailureRecord[] = [];
  const lines = log.split('\n');

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    const eslintMatch = line.match(ESLINT_PATTERN);
    if (eslintMatch) {
      const [, file, lineNum, column, severity, message, rule] = eslintMatch;
      if (severity === 'error') {
        failures.push({
          type: 'lint',
          file: file.trim(),
          line: Number.parseInt(lineNum, 10),
          column: Number.parseInt(column, 10),
          message: message.trim(),
          rule: rule?.trim() || null,
          rawLog: line,
          confidence: rule ? 0.95 : 0.8,
        });
      }

      continue;
    }

    const biomeMatch = line.match(BIOME_PATTERN);
    if (!biomeMatch) {
      continue;
    }

    const [, file, lineNum, column, rule] = biomeMatch;
    const messageLine = index + 2 < lines.length ? lines[index + 2].trim() : '';

    failures.push({
      type: 'lint',
      file: file.trim(),
      line: Number.parseInt(lineNum, 10),
      column: Number.parseInt(column, 10),
      message: messageLine || `Biome error: ${rule}`,
      rule: rule.trim(),
      rawLog: lines.slice(index, Math.min(index + 5, lines.length)).join('\n'),
      confidence: 0.9,
    });
  }

  return failures;
}
