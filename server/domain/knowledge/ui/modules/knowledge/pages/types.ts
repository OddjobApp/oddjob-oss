// Visual Query Builder Types

export interface VisualQueryNode {
    id: string;
    label: string;
    alias?: string;
    filters?: Array<{
        property: string;
        operator: '=' | '!=' | '>' | '<' | '>=' | '<=' | 'contains' | 'starts_with' | 'ends_with';
        value: any;
        logicalOperator?: 'AND' | 'OR';
    }>;
}

export interface VisualQueryRelationship {
    id: string;
    type: string;
    sourceNodeId: string;
    targetNodeId: string;
    direction: 'outgoing' | 'incoming' | 'both';
    minHops?: number;
    maxHops?: number;
    filters?: Array<{
        property: string;
        operator: string;
        value: any;
    }>;
}

export interface VisualQuery {
    nodes: VisualQueryNode[];
    relationships: VisualQueryRelationship[];
    returnClause: {
        items: Array<{
            type: 'node' | 'relationship' | 'property' | 'path';
            id?: string;
            property?: string;
        }>;
    };
    limit?: number;
    orderBy?: Array<{
        property: string;
        direction: 'ASC' | 'DESC';
    }>;
}

export interface QueryTemplate {
    id?: number;
    name: string;
    description?: string;
    category?: 'common' | 'advanced' | 'custom';
    queryStructure: VisualQuery;
    cypherTemplate?: string;
    parameters?: any[];
    isPublic?: boolean;
    organizationId?: number;
    createdBy?: string;
}

export interface SavedQuery {
    id?: number;
    name: string;
    description?: string;
    queryStructure: VisualQuery;
    cypherQuery?: string;
    organizationId?: number;
    createdBy?: string;
    lastRunAt?: Date;
    runCount?: number;
}
