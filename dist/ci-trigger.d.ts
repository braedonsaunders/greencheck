import * as github from '@actions/github';
import { CIWorkflowRun } from './types';
type Octokit = ReturnType<typeof github.getOctokit>;
interface WorkflowWaitOptions {
    timeoutMs?: number;
    cooldownMs?: number;
    pollIntervalMs?: number;
    dispatchWorkflowId?: string | number | null;
    dispatchOctokit?: Octokit;
    emptyPollsBeforeDispatch?: number;
}
export declare function rerunFailedJobs(octokit: Octokit, owner: string, repo: string, runId: number): Promise<boolean>;
export declare function triggerWorkflowDispatch(octokit: Octokit, owner: string, repo: string, workflowId: string | number, branch: string): Promise<boolean>;
export declare function waitForWorkflowCompletion(octokit: Octokit, owner: string, repo: string, branch: string, headSha: string, options?: WorkflowWaitOptions): Promise<CIWorkflowRun | null>;
export declare function getLatestRunForBranch(octokit: Octokit, owner: string, repo: string, branch: string, workflowName?: string): Promise<CIWorkflowRun | null>;
export {};
