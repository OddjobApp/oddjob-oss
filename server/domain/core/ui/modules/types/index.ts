import { LucideIcon } from 'lucide-react';

export interface Widget {
    id: string;
    name: string;
    description: string;
    icon: LucideIcon;
    component: React.ComponentType<any>;
    defaultSize: { width: number; height: number };
    minSize?: { width: number; height: number };
    configurable?: boolean;
}

export interface WidgetInstance {
    id: string;
    widgetId: string;
    position: { x: number; y: number };
    size: { width: number; height: number };
    config?: Record<string, any>;
}

export interface DashboardLayout {
    id: number;
    name: string;
    widgets: WidgetInstance[];
    isDefault?: boolean;
}
