import { FailureCluster, FailureRecord, GreenCheckConfig } from './types';
export declare function clusterFailures(failures: FailureRecord[]): FailureCluster[];
export declare function prioritizeClusters(clusters: FailureCluster[]): FailureCluster[];
export declare function filterByConfig(clusters: FailureCluster[], config: GreenCheckConfig): FailureCluster[];
export declare function triageFailures(failures: FailureRecord[], config: GreenCheckConfig): FailureCluster[];
