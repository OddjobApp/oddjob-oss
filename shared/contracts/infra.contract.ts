/**
 * IXRayPod Contract
 */
export interface IXRayPod {
    indexBlueprints(): Promise<void>;
    getQuery(options: any): Promise<any>;
}

/**
 * IRescuePod Contract
 */
export interface IRescuePod {
    rescue: {
        attemptRescue(options: any): Promise<any>;
    };
    telemetry: {
        getPulse(): Promise<any>;
    };
}

/**
 * IPipelinePod Contract
 */
export interface IPipelinePod {
    engine: any;
    execution: any;
    analytics: any;
    monitor: any;
    suggestions: any;
    trigger: any;
    graph: any;
}

/**
 * IAuthPod Contract
 */
export interface IAuthPod {
    engine: {
        authenticate(credentials: any): Promise<any>;
    };
    users: {
        getUser(id: string): Promise<any>;
    };
}

/**
 * IBillingPod Contract
 */
export interface IBillingPod {
    createSubscription(options: any): Promise<any>;
    getInvoices(customerId: string): Promise<any[]>;
}

/**
 * IAnalyticsPod Contract
 */
export interface IAnalyticsPod {
    analytics: any;
    reporting: any;
}

/**
 * IAiPod Contract
 */
export interface IAiPod {
    generateResponse(prompt: string, options?: any): Promise<any>;
}

/**
 * IProspectingPod Contract
 */
export interface IProspectingPod {
    startSearch(criteria: any): Promise<any>;
    getResults(searchId: string): Promise<any[]>;
}

/**
 * IEvolutionPod Contract
 */
export interface IEvolutionPod {
    service: any;
    docs: any;
    healing: any;
}
