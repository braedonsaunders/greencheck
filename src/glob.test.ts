import { describe, expect, it } from 'vitest';
import { matchesGlob, normalizePath } from './glob';

describe('normalizePath', () => {
  it('strips leading ./', () => {
    expect(normalizePath('./src/index.ts')).toBe('src/index.ts');
  });

  it('normalizes backslashes to forward slashes', () => {
    expect(normalizePath('src\\utils\\helper.ts')).toBe('src/utils/helper.ts');
  });

  it('handles already-clean paths', () => {
    expect(normalizePath('src/index.ts')).toBe('src/index.ts');
  });

  it('handles empty string', () => {
    expect(normalizePath('')).toBe('');
  });
});

describe('matchesGlob', () => {
  it('matches exact file name', () => {
    expect(matchesGlob('package-lock.json', 'package-lock.json')).toBe(true);
  });

  it('matches wildcard extension patterns', () => {
    expect(matchesGlob('yarn.lock', '*.lock')).toBe(true);
    expect(matchesGlob('package-lock.json', '*.lock')).toBe(false);
  });

  it('matches .env* patterns', () => {
    expect(matchesGlob('.env', '.env*')).toBe(true);
    expect(matchesGlob('.env.local', '.env*')).toBe(true);
    expect(matchesGlob('.env.production', '.env*')).toBe(true);
    expect(matchesGlob('src/.env', '.env*')).toBe(true);
  });

  it('matches basename when pattern has no directory', () => {
    expect(matchesGlob('src/utils/helper.lock', '*.lock')).toBe(true);
    expect(matchesGlob('deep/nested/path/yarn.lock', '*.lock')).toBe(true);
  });

  it('matches full path patterns', () => {
    expect(matchesGlob('src/index.ts', 'src/index.ts')).toBe(true);
    expect(matchesGlob('src/index.ts', 'lib/index.ts')).toBe(false);
  });

  it('matches directory wildcard patterns', () => {
    expect(matchesGlob('src/index.ts', 'src/*')).toBe(true);
    expect(matchesGlob('src/utils/index.ts', 'src/*')).toBe(true);
  });

  it('returns false for empty inputs', () => {
    expect(matchesGlob('', '*.ts')).toBe(false);
    expect(matchesGlob('src/index.ts', '')).toBe(false);
    expect(matchesGlob('', '')).toBe(false);
  });

  it('handles Windows-style paths', () => {
    expect(matchesGlob('src\\index.ts', 'src/index.ts')).toBe(true);
  });

  it('handles leading ./ in both file and pattern', () => {
    expect(matchesGlob('./src/index.ts', 'src/index.ts')).toBe(true);
    expect(matchesGlob('src/index.ts', './src/index.ts')).toBe(true);
  });
});
