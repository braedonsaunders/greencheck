import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from './config';

const INPUT_PREFIX = 'INPUT_';

describe('loadConfig', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'greencheck-config-'));
    clearInputs();
  });

  afterEach(() => {
    clearInputs();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('lets repo config override action defaults when no explicit input is set', () => {
    fs.writeFileSync(
      path.join(tempDir, '.greencheck.yml'),
      [
        'fix:',
        '  agent: codex',
        '  max-passes: 2',
        '  max-cost: "$1.25"',
        '  timeout: 5m',
        '  types: [lint, test-failure]',
        'watch:',
        '  workflows: [CI, Lint]',
        'merge:',
        '  enabled: true',
      ].join('\n'),
    );
    process.env.INPUT_CONFIG_PATH = path.join(tempDir, '.greencheck.yml');

    const config = loadConfig();
    expect(config.agent).toBe('codex');
    expect(config.maxPasses).toBe(2);
    expect(config.maxCostCents).toBe(125);
    expect(config.timeoutMs).toBe(5 * 60 * 1000);
    expect(config.fixTypes).toEqual(['lint', 'test-failure']);
    expect(config.watchWorkflows).toEqual(['CI', 'Lint']);
    expect(config.autoMerge).toBe(true);
  });

  it('lets explicit inputs override repo config, including false booleans', () => {
    fs.writeFileSync(
      path.join(tempDir, '.greencheck.yml'),
      ['merge:', '  enabled: true', 'fix:', '  max-passes: 2'].join('\n'),
    );

    process.env.INPUT_CONFIG_PATH = path.join(tempDir, '.greencheck.yml');
    process.env.INPUT_AUTO_MERGE = 'false';
    process.env.INPUT_MAX_PASSES = '7';

    const config = loadConfig();
    expect(config.autoMerge).toBe(false);
    expect(config.maxPasses).toBe(7);
  });
});

function clearInputs(): void {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith(INPUT_PREFIX)) {
      delete process.env[key];
    }
  }
}
