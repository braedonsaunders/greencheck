import * as core from '@actions/core';
import * as fs from 'fs';
import * as path from 'path';
import { RunState } from './types';

const CHECKPOINT_DIR = '.greencheck';
const CHECKPOINT_FILE = 'state.json';

function getCheckpointPath(workDir?: string): string {
  const dir = path.join(workDir || process.cwd(), CHECKPOINT_DIR);
  return path.join(dir, CHECKPOINT_FILE);
}

export function saveCheckpoint(state: RunState, workDir?: string): void {
  try {
    const filePath = getCheckpointPath(workDir);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
    core.info(`Checkpoint saved: ${state.passes.length} passes, ${state.commits.length} commits`);
  } catch (err) {
    core.warning(`Failed to save checkpoint: ${err}`);
  }
}

export function loadCheckpoint(workDir?: string): RunState | null {
  try {
    const filePath = getCheckpointPath(workDir);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    const state = JSON.parse(content) as RunState;
    state.latestFailures = state.latestFailures || [];
    state.latestParserUsed = state.latestParserUsed || 'none';
    state.latestLogPath = state.latestLogPath || null;
    state.workflowName = state.workflowName || '';
    state.workflowUrl = state.workflowUrl || '';
    core.info(`Loaded checkpoint: ${state.passes.length} passes, ${state.commits.length} commits`);
    return state;
  } catch (err) {
    core.warning(`Failed to load checkpoint: ${err}`);
    return null;
  }
}

export function clearCheckpoint(workDir?: string): void {
  try {
    const filePath = getCheckpointPath(workDir);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      core.info('Checkpoint cleared');
    }
  } catch (err) {
    core.warning(`Failed to clear checkpoint: ${err}`);
  }
}
