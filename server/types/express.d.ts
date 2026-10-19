declare module "express-serve-static-core" {
  interface Request {
    correlationId?: string;
    organizationId?: number;
    /** Active Project Space, set by withProjectScope (docs/PROJECT_SPACES_DESIGN.md §6.1). */
    projectId?: number;
    projectKey?: string;
    requestStartTime?: number;
    logger?: any;
    user?: {
      id: string;
      username: string;
      email?: string;
      defaultOrgId?: number;
    };
  }
}

export {};

