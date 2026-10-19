/**
 * IAppPod Contract
 */
export interface IAppPod {
    getApp(slug: string): Promise<any>;
    listApps(orgId?: number): Promise<any[]>;
    provisionInstance(deploymentId: number): Promise<any>;
    decommissionInstance(instanceId: number): Promise<void>;
}
