export interface SyncConfiguration {
    platform: string;
    enabled: boolean;
    sync_interval: number; // minutes
    conflict_resolution: string;
    field_mappings: Record<string, string>;
    filters: Record<string, any>;
    last_sync?: string;
    next_sync?: string;
    status?: string;
}

export interface SyncHistoryEvent {
    id: string;
    timestamp: string;
    platform: string;
    sync_type: string;
    status: string;
    details: {
        items_synced?: number;
        error?: string;
        [key: string]: any;
    };
}

export interface Connector {
    platform: string;
    status: string;
    config_name: string;
    is_enabled: boolean;
    base_url?: string;
    username?: string;
    allowed_projects?: string[];
    error_message?: string;
}

export interface SyncFormData {
    platform: string;
    enabled: boolean;
    sync_interval: number;
    conflict_resolution: string;
    field_mappings: string; // JSON string
    filters: string; // JSON string
}
