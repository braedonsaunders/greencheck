export type AgentType = 'claude' | 'codex';
export type AuthMethod = 'api-key' | 'oauth';
export type FailureType = 'lint' | 'type-error' | 'test-failure' | 'build-error' | 'runtime-error' | 'unknown';
export type FixStrategy = 'deterministic' | 'llm' | 'deterministic+llm';
export type PassResult = 'fixed' | 'partial' | 'failed' | 'regression' | 'timeout' | 'cost-limit';
export type RunResult = 'success' | 'partial' | 'failed' | 'error';
export interface FailureRecord {
    type: FailureType;
    file: string;
    line: number | null;
    column: number | null;
    message: string;
    rule: string | null;
    rawLog: string;
    confidence: number;
}
export interface FailureCluster {
    type: FailureType;
    files: string[];
    failures: FailureRecord[];
    strategy: FixStrategy;
}
export interface AgentContext {
    workflowRunId: number;
    workflowName: string;
    workflowUrl: string;
    branch: string;
    headSha: string;
    parserUsed: string;
    logPath: string | null;
    rawLog: string;
    parsedFailures: FailureRecord[];
}
export interface GreenCheckConfig {
    agent: AgentType;
    agentApiKey: string | null;
    agentOAuthToken: string | null;
    githubToken: string;
    triggerToken: string;
    maxPasses: number;
    maxCostCents: number;
    timeoutMs: number;
    autoMerge: boolean;
    watchWorkflows: string[];
    fixTypes: FailureType[] | 'all';
    model: string | null;
    dryRun: boolean;
    configPath: string;
    watch: {
        workflows: string[];
        branches: string[];
        ignoreAuthors: string[];
    };
    fix: {
        types: FailureType[];
        maxFilesPerFix: number;
    };
    merge: {
        enabled: boolean;
        maxCommits: number;
        requireLabel: boolean;
        protectedPatterns: string[];
    };
    report: {
        prComment: boolean;
        jobSummary: boolean;
        slackWebhook: string | null;
    };
    safety: {
        neverTouchFiles: string[];
        maxFilesPerFix: number;
        revertOnRegression: boolean;
    };
}
export interface CIWorkflowRun {
    id: number;
    name: string;
    headBranch: string;
    headSha: string;
    status: string;
    conclusion: string | null;
    htmlUrl: string;
    event: string;
    pullRequests: Array<{
        number: number;
        headRef: string;
        headSha: string;
    }>;
}
export interface FixAttempt {
    pass: number;
    cluster: FailureCluster;
    commitSha: string | null;
    filesChanged: string[];
    result: PassResult;
    newFailures: FailureRecord[];
    costCents: number;
    durationMs: number;
}
export interface RunState {
    runId: number;
    workflowRunId: number;
    workflowName: string;
    workflowUrl: string;
    branch: string;
    headSha: string;
    prNumber: number | null;
    passes: FixAttempt[];
    totalCostCents: number;
    startedAt: string;
    result: RunResult | null;
    commits: string[];
    latestFailures: FailureRecord[];
    latestParserUsed: string;
    latestLogPath: string | null;
}
export interface AgentInvocation {
    agent: AgentType;
    mode: 'sdk' | 'cli';
    prompt: string;
    model: string | null;
    filesChanged: string[];
    costCents: number;
    durationMs: number;
    exitCode: number;
    stdout: string;
    stderr: string;
}
export interface LogParserResult {
    failures: FailureRecord[];
    rawLog: string;
    parserUsed: string;
    logPath: string | null;
}
