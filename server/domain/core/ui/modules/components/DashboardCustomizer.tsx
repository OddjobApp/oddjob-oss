import { useState } from 'react';
import { Plus, Settings, X } from 'lucide-react';
import { AVAILABLE_WIDGETS } from './WidgetRegistry.js';
import { WidgetInstance } from '../types/index.js';

interface DashboardCustomizerProps {
    widgets: WidgetInstance[];
    onAddWidget: (widgetId: string) => void;
    onRemoveWidget: (instanceId: string) => void;
    onSaveLayout: (name: string) => void;
}

export function DashboardCustomizer({
    widgets,
    onAddWidget,
    onRemoveWidget,
    onSaveLayout,
}: DashboardCustomizerProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [layoutName, setLayoutName] = useState('');

    const usedWidgetIds = new Set(widgets.map(w => w.widgetId));
    const availableWidgets = Object.values(AVAILABLE_WIDGETS).filter(
        w => !usedWidgetIds.has(w.id)
    );

    const handleAddWidget = (widgetId: string) => {
        onAddWidget(widgetId);
        setIsOpen(false);
    };

    const handleSaveLayout = () => {
        if (layoutName.trim()) {
            onSaveLayout(layoutName);
            setLayoutName('');
        }
    };

    return (
        <div className="dashboard-customizer">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="btn-secondary"
                aria-label="Customize dashboard"
            >
                <Settings className="w-4 h-4" />
                Customize Dashboard
            </button>

            {isOpen && (
                <div className="customizer-panel">
                    <div className="panel-header">
                        <h3>Add Widgets</h3>
                        <button onClick={() => setIsOpen(false)} aria-label="Close">
                            <X className="w-4 h-4" />
                        </button>
                    </div>

                    <div className="widget-list">
                        {availableWidgets.map(widget => {
                            const Icon = widget.icon;
                            return (
                                <div
                                    key={widget.id}
                                    className="widget-option"
                                    onClick={() => handleAddWidget(widget.id)}
                                >
                                    <Icon className="w-5 h-5" />
                                    <div className="widget-info">
                                        <div className="widget-name">{widget.name}</div>
                                        <div className="widget-description">{widget.description}</div>
                                    </div>
                                    <Plus className="w-4 h-4 add-icon" />
                                </div>
                            );
                        })}
                    </div>

                    <div className="panel-footer">
                        <input
                            type="text"
                            placeholder="Layout name..."
                            value={layoutName}
                            onChange={(e) => setLayoutName(e.target.value)}
                            className="layout-name-input"
                        />
                        <button
                            onClick={handleSaveLayout}
                            disabled={!layoutName.trim()}
                            className="btn-primary"
                        >
                            Save Layout
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
