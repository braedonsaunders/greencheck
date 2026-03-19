import { RunState } from './types';
export declare function saveCheckpoint(state: RunState, workDir?: string): void;
export declare function loadCheckpoint(workDir?: string): RunState | null;
export declare function clearCheckpoint(workDir?: string): void;
