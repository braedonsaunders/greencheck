import { AgentInvocation, FailureCluster, GreenCheckConfig } from './types';
declare function buildPrompt(cluster: FailureCluster): string;
export declare function invokeAgent(cluster: FailureCluster, config: GreenCheckConfig, workDir: string): Promise<AgentInvocation>;
export { buildPrompt };
