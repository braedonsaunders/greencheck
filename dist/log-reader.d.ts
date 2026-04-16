import * as github from '@actions/github';
import { CIWorkflowRun, FailureRecord, LogParserResult } from './types';
type Octokit = ReturnType<typeof github.getOctokit>;
export declare function getFailedWorkflowRun(octokit: Octokit, owner: string, repo: string, workflowRunId: number): Promise<CIWorkflowRun | null>;
export declare function downloadWorkflowLogs(octokit: Octokit, owner: string, repo: string, runId: number): Promise<string>;
export declare function getFailedJobLogs(octokit: Octokit, owner: string, repo: string, runId: number): Promise<string>;
export declare function readAndParseFailures(octokit: Octokit, owner: string, repo: string, runId: number): Promise<LogParserResult>;
export declare function resolveFailurePaths(failures: FailureRecord[], workDir?: string): FailureRecord[];
export {};
