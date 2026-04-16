import { describe, it, expect } from 'vitest';
import { clusterFailures, prioritizeClusters } from './triage';
import { FailureRecord } from './types';

describe('clusterFailures', () => {
  it('groups non-test failures by type and file directory', () => {
    const failures: FailureRecord[] = [
      { type: 'lint', file: 'src/auth.ts', line: 10, column: 5, message: 'unused var', rule: 'no-unused-vars', rawLog: '', confidence: 0.9 },
      { type: 'lint', file: 'src/auth.ts', line: 20, column: 3, message: 'missing semi', rule: 'semi', rawLog: '', confidence: 0.9 },
      { type: 'type-error', file: 'src/types.ts', line: 5, column: 1, message: 'TS2304', rule: 'TS2304', rawLog: '', confidence: 0.95 },
    ];

    const clusters = clusterFailures(failures);
    expect(clusters).toHaveLength(2); // lint cluster + type-error cluster

    const lintCluster = clusters.find((c) => c.type === 'lint');
    expect(lintCluster?.failures).toHaveLength(2);

    const typeCluster = clusters.find((c) => c.type === 'type-error');
    expect(typeCluster?.failures).toHaveLength(1);
  });

  it('keeps test failures split by file so they can be fixed incrementally', () => {
    const failures: FailureRecord[] = [
      { type: 'test-failure', file: 'backend/tests/a.test.py', line: 10, column: null, message: 'first failure', rule: null, rawLog: '', confidence: 0.9 },
      { type: 'test-failure', file: 'backend/tests/b.test.py', line: 20, column: null, message: 'second failure', rule: null, rawLog: '', confidence: 0.8 },
      { type: 'test-failure', file: 'backend/tests/b.test.py', line: 30, column: null, message: 'third failure', rule: null, rawLog: '', confidence: 0.7 },
    ];

    const clusters = clusterFailures(failures);

    expect(clusters).toHaveLength(2);
    expect(clusters.map((cluster) => cluster.files)).toEqual([
      ['backend/tests/a.test.py'],
      ['backend/tests/b.test.py'],
    ]);
  });
});

describe('prioritizeClusters', () => {
  it('puts lint before type errors before test failures', () => {
    const clusters = [
      { type: 'test-failure' as const, files: ['test.ts'], failures: [], strategy: 'llm' as const },
      { type: 'lint' as const, files: ['src.ts'], failures: [], strategy: 'deterministic+llm' as const },
      { type: 'type-error' as const, files: ['types.ts'], failures: [], strategy: 'llm' as const },
    ];

    const sorted = prioritizeClusters(clusters);
    expect(sorted[0].type).toBe('lint');
    expect(sorted[1].type).toBe('type-error');
    expect(sorted[2].type).toBe('test-failure');
  });
});
