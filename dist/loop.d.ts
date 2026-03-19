import * as github from '@actions/github';
import { GreenCheckConfig, RunState } from './types';
type Octokit = ReturnType<typeof github.getOctokit>;
export declare function runFixLoop(octokit: Octokit, owner: string, repo: string, state: RunState, config: GreenCheckConfig): Promise<RunState>;
export {};
