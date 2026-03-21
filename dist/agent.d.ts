import { AgentContext, AgentInvocation, FailureCluster, GreenCheckConfig } from './types';
declare function buildPrompt(context: AgentContext, cluster: FailureCluster): string;
export declare function invokeAgent(context: AgentContext, cluster: FailureCluster, config: GreenCheckConfig, workDir: string): Promise<AgentInvocation>;
export { buildPrompt };
