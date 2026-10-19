import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@domain-ui/core/ui/components/ui/tabs";
import ObservabilityDashboard from './ObservabilityDashboard.js';
import { ExecutionListView } from './Monitoring.js';
import Alerts from "@domain-ui/core/ui/modules/components/Alerts";
import Monitoring from './Monitoring.js';
import Events from './Events.js';
import { Activity, AlertTriangle, ClipboardList, LineChart } from "lucide-react";
import { PageShell } from "@domain-ui/core/ui/components/layout/PageShell";

export default function UnifiedObservability() {
    const [location, setLocation] = useLocation();

    // Determine default tab from URL or default to dashboard
    const getTabFromUrl = () => {
        if (location.includes("/monitoring")) return "health";
        if (location.includes("/alerts")) return "alerts";
        if (location.includes("/events")) return "events";
        return "dashboard";
    };

    const [activeTab, setActiveTab] = useState(getTabFromUrl());

    const handleTabChange = (value: string) => {
        setActiveTab(value);
    };

    return (
        <PageShell
            title="System Observability"
            description="Unified view of system health, performance, and diagnostics."
        >
            <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-4">
                <TabsList className="bg-card border shadow-sm">
                    <TabsTrigger value="dashboard" className="flex items-center gap-2">
                        <LineChart className="w-4 h-4" />
                        Dashboard
                    </TabsTrigger>
                    <TabsTrigger value="health" className="flex items-center gap-2">
                        <Activity className="w-4 h-4" />
                        Executions & Health
                    </TabsTrigger>
                    <TabsTrigger value="alerts" className="flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4" />
                        Alerts
                    </TabsTrigger>
                    <TabsTrigger value="events" className="flex items-center gap-2">
                        <ClipboardList className="w-4 h-4" />
                        Event Log
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="dashboard" className="space-y-4">
                    <ObservabilityDashboard />
                </TabsContent>

                <TabsContent value="health" className="space-y-4">
                    <div className="bg-card rounded-xl border shadow-sm p-6">
                        <ExecutionListView />
                    </div>
                </TabsContent>

                <TabsContent value="alerts" className="space-y-4">
                    <div className="bg-card rounded-xl border shadow-sm p-6">
                        <Alerts />
                    </div>
                </TabsContent>

                <TabsContent value="events" className="space-y-4">
                    <div className="bg-card rounded-xl border shadow-sm p-6">
                        <Events />
                    </div>
                </TabsContent>
            </Tabs>
        </PageShell>
    );
}
