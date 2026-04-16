import * as github from '@actions/github';
import { FailureCluster, FailureRecord, GreenCheckConfig, LogParserResult, RunState } from './types';
type Octokit = ReturnType<typeof github.getOctokit>;
export declare function runFixLoop(octokit: Octokit, owner: string, repo: string, state: RunState, config: GreenCheckConfig): Promise<RunState>;
export declare function buildAgentCluster(logResult: LogParserResult, config: GreenCheckConfig): FailureCluster;
declare function getFailureKey(failure: FailureRecord): string;
export { getFailureKey };
