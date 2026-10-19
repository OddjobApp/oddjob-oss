import { QuickBooksConnectionOptions } from '@/components/QuickBooksConnectionOptions';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@domain-ui/core/ui/components/ui/tabs";
import { ConnectorsDashboard } from "@domain-ui/ecommerce/ui/modules/saas";
import McpServersSettings from '../components/McpServersSettings.js';
import { Activity, Globe, Server } from "lucide-react";
import { motion } from "framer-motion";
import IntegrationReliabilityCenter from "../components/IntegrationReliabilityCenter.js";
import { GoogleConnectionOptions } from '@/components/GoogleConnectionOptions';
import { GranolaConnectionCard } from '@/components/GranolaConnectionCard';
import { ReauthorizeConnectionsCard } from '@/components/ReauthorizeConnectionsCard';

export default function IntegrationsAdmin() {
    return (
        <div className="space-y-6">
            {/* Page Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-foreground">Integrations</h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        Connect external platforms and configure MCP tool servers.
                    </p>
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <span>Connection settings</span>
                </div>
            </div>

            <ReauthorizeConnectionsCard />
            <GranolaConnectionCard />
            <GoogleConnectionOptions />
            <QuickBooksConnectionOptions />
            <Tabs defaultValue="reliability" className="space-y-6">
                <TabsList>
                    <TabsTrigger value="reliability" className="gap-2">
                        <Activity className="w-4 h-4" />
                        Reliability
                    </TabsTrigger>
                    <TabsTrigger value="saas" className="gap-2">
                        <Globe className="w-4 h-4" />
                        SaaS Platforms
                    </TabsTrigger>
                    <TabsTrigger value="mcp_servers" className="gap-2">
                        <Server className="w-4 h-4" />
                        MCP Servers
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="reliability" className="mt-0 outline-none">
                    <IntegrationReliabilityCenter />
                </TabsContent>

                <TabsContent value="saas" className="mt-0 outline-none">
                    <motion.div
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="bg-card border border-border rounded-xl overflow-hidden"
                    >
                        <ConnectorsDashboard />
                    </motion.div>
                </TabsContent>

                <TabsContent value="mcp_servers" className="mt-0 outline-none">
                    <motion.div
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                    >
                        <McpServersSettings />
                    </motion.div>
                </TabsContent>
            </Tabs>
        </div>
    );
}
