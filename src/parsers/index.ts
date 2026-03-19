import { FailureRecord, LogParserResult } from '../types';
import stripAnsi from 'strip-ansi';
import { parseEslint } from './eslint';
import { parseTypeScript } from './typescript';
import { parseJest } from './jest';
import { parsePytest } from './pytest';
import { parseGo } from './go';
import { parseRust } from './rust';

interface Parser {
  name: string;
  detect: (log: string) => boolean;
  parse: (log: string) => FailureRecord[];
}

const parsers: Parser[] = [
  {
    name: 'eslint',
    detect: (log) =>
      /\d+:\d+\s+(error|warning)\s+.+\s{2,}\S+/.test(log) ||
      /eslint/i.test(log) ||
      /^.+:\d+:\d+\s+lint\/\S+\s+\u2501+/m.test(log) ||
      /biome/i.test(log),
    parse: parseEslint,
  },
  {
    name: 'typescript',
    detect: (log) => /error TS\d+/.test(log),
    parse: parseTypeScript,
  },
  {
    name: 'jest',
    detect: (log) => /FAIL\s+.+\.(test|spec)\.\w+/.test(log) || /jest/i.test(log) || /vitest/i.test(log),
    parse: parseJest,
  },
  {
    name: 'pytest',
    detect: (log) => /FAILED\s+\S+::\S+/.test(log) || /pytest/i.test(log),
    parse: parsePytest,
  },
  {
    name: 'go',
    detect: (log) =>
      /--- FAIL:/.test(log) ||
      /^FAIL\s+\S+\s+[\d.]+s$/m.test(log) ||
      /^\.?\/?[\w/.-]+\.go:\d+:\d+:\s+.+$/m.test(log),
    parse: parseGo,
  },
  {
    name: 'rust',
    detect: (log) => /error\[E\d+\]/.test(log) || /cargo\s+(test|build|check)/.test(log),
    parse: parseRust,
  },
];

export function parseLog(rawLog: string): LogParserResult {
  const allFailures: FailureRecord[] = [];
  const parsersUsed: string[] = [];

  const cleanLog = stripAnsi(rawLog);

  for (const parser of parsers) {
    if (parser.detect(cleanLog)) {
      const failures = parser.parse(cleanLog);
      if (failures.length > 0) {
        allFailures.push(...failures);
        parsersUsed.push(parser.name);
      }
    }
  }

  // Deduplicate by file+line+message
  const seen = new Set<string>();
  const deduplicated = allFailures.filter((f) => {
    const key = `${f.file}:${f.line}:${f.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    failures: deduplicated,
    rawLog: cleanLog,
    parserUsed: parsersUsed.join(', ') || 'none',
  };
}
export { parseEslint } from './eslint';
export { parseTypeScript } from './typescript';
export { parseJest } from './jest';
export { parsePytest } from './pytest';
export { parseGo } from './go';
export { parseRust } from './rust';
