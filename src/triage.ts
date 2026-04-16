import * as core from '@actions/core';
import { FailureCluster, FailureRecord, FailureType, FixStrategy, GreenCheckConfig } from './types';
import { matchesGlob, normalizePath } from './glob';

const FIXABILITY_ORDER: FailureType[] = [
  'lint',
  'type-error',
  'test-failure',
  'build-error',
  'runtime-error',
  'unknown',
];

function getStrategy(type: FailureType, failures: FailureRecord[]): FixStrategy {
  switch (type) {
    case 'lint': {
      const hasAutoFixable = failures.some(
        (failure) =>
          failure.rule !== null &&
          [
            'no-unused-vars',
            'semi',
            'quotes',
            'indent',
            'comma-dangle',
            'eol-last',
            'no-trailing-spaces',
            'no-multiple-empty-lines',
          ].includes(failure.rule),
      );

      return hasAutoFixable ? 'deterministic+llm' : 'llm';
    }
    case 'test-failure':
      return failures.some((failure) => failure.rule === 'snapshot') ? 'deterministic+llm' : 'llm';
    default:
      return 'llm';
  }
}

export function clusterFailures(failures: FailureRecord[]): FailureCluster[] {
  const grouped = new Map<FailureType, Map<string, Map<string, FailureRecord[]>>>();

  for (const failure of failures) {
    const normalizedFailure = {
      ...failure,
      file: normalizePath(failure.file),
    };
    const typeGroups = grouped.get(normalizedFailure.type) || new Map<string, Map<string, FailureRecord[]>>();
    const clusterKey = getClusterKey(normalizedFailure.type, normalizedFailure.file);
    const fileGroups = typeGroups.get(clusterKey) || new Map<string, FailureRecord[]>();
    const fileFailures = fileGroups.get(normalizedFailure.file) || [];
    fileFailures.push(normalizedFailure);
    fileGroups.set(normalizedFailure.file, fileFailures);
    typeGroups.set(clusterKey, fileGroups);
    grouped.set(normalizedFailure.type, typeGroups);
  }

  const clusters: FailureCluster[] = [];

  for (const [type, typeGroups] of grouped) {
    for (const fileGroups of typeGroups.values()) {
      const groupedFailures = Array.from(fileGroups.values()).flat();
      const files = Array.from(fileGroups.keys());

      clusters.push({
        type,
        files,
        failures: groupedFailures,
        strategy: getStrategy(type, groupedFailures),
      });
    }
  }

  return clusters;
}

export function prioritizeClusters(clusters: FailureCluster[]): FailureCluster[] {
  return [...clusters].sort((a, b) => {
    const aIdx = FIXABILITY_ORDER.indexOf(a.type);
    const bIdx = FIXABILITY_ORDER.indexOf(b.type);
    if (aIdx !== bIdx) {
      return aIdx - bIdx;
    }

    if (a.strategy !== b.strategy) {
      if (a.strategy === 'deterministic') return -1;
      if (b.strategy === 'deterministic') return 1;
      if (a.strategy === 'deterministic+llm') return -1;
      if (b.strategy === 'deterministic+llm') return 1;
    }

    if (a.failures.length !== b.failures.length) {
      return b.failures.length - a.failures.length;
    }

    return averageConfidence(b.failures) - averageConfidence(a.failures);
  });
}

export function filterByConfig(
  clusters: FailureCluster[],
  config: GreenCheckConfig,
): FailureCluster[] {
  const allowedTypes = config.fixTypes === 'all' ? FIXABILITY_ORDER : config.fixTypes;

  return clusters
    .filter((cluster) => allowedTypes.includes(cluster.type))
    .map((cluster) => ({
      ...cluster,
      files: cluster.files.filter((file) => !isProtectedFile(file, config.safety.neverTouchFiles)),
      failures: cluster.failures.filter(
        (failure) => !isProtectedFile(failure.file, config.safety.neverTouchFiles),
      ),
    }))
    .filter(
      (cluster) => cluster.failures.length > 0 && cluster.files.length <= config.safety.maxFilesPerFix,
    );
}

export function triageFailures(
  failures: FailureRecord[],
  config: GreenCheckConfig,
): FailureCluster[] {
  core.info(`Triaging ${failures.length} failures...`);

  const clusters = clusterFailures(failures);
  core.info(`Grouped into ${clusters.length} clusters`);

  const filtered = filterByConfig(clusters, config);
  core.info(`${filtered.length} clusters after filtering by config`);

  const prioritized = prioritizeClusters(filtered);
  for (const cluster of prioritized) {
    core.info(
      `  [${cluster.type}] ${cluster.files.join(', ')} - ${cluster.failures.length} failures - strategy: ${cluster.strategy}`,
    );
  }

  return prioritized;
}

function isProtectedFile(file: string, patterns: string[]): boolean {
  return patterns.some((pattern) => matchesGlob(file, pattern));
}

function getDirectory(file: string): string {
  const normalized = normalizePath(file);
  const lastSlash = normalized.lastIndexOf('/');
  return lastSlash === -1 ? '' : normalized.slice(0, lastSlash);
}

function getClusterKey(type: FailureType, file: string): string {
  if (type === 'test-failure') {
    return normalizePath(file);
  }

  return getDirectory(file);
}

function averageConfidence(failures: FailureRecord[]): number {
  if (failures.length === 0) {
    return 0;
  }

  return failures.reduce((sum, failure) => sum + failure.confidence, 0) / failures.length;
}
