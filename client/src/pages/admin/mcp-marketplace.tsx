"use client";

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  Server, ShieldAlert, CheckCircle, Download, ExternalLink, Blocks, Sparkles, HardDrive, Globe, Github
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@domain-ui/core/ui/hooks/use-toast';

interface McpServer {
  id: number;
  name: string;
  description: string;
  command: string;
  args: string[];
  status: string;
  transport: string;
}

// Pre-approved catalog of MCP servers
const MCP_CATALOG = [
  {
    name: "Puppeteer (Web Browsing)",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-puppeteer"],
    description: "Allows agents to securely navigate the web, scrape content, and interact with web applications.",
    icon: <Globe className="w-8 h-8 text-blue-500" />
  },
  {
    name: "PostgreSQL Database",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-postgres", "postgresql://localhost/mydb"],
    description: "Provides direct, read-only SQL access for data analysts and reasoning agents.",
    icon: <HardDrive className="w-8 h-8 text-emerald-500" />
  },
  {
    name: "GitHub Integration",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    description: "Access repositories, pull requests, and issues directly from your agentic workflows.",
    icon: <Github className="w-8 h-8 text-gray-700 dark:text-gray-300" />
  },
  {
    name: "Local Filesystem",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "./data"],
    description: "Read and write access to a sandboxed local directory.",
    icon: <Blocks className="w-8 h-8 text-purple-500" />
  }
];

export default function McpMarketplacePage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isSuperAdmin, setIsSuperAdmin] = useState(true); // Assuming true for now

  // Fetch installed and suggested servers
  const { data: servers = [], isLoading } = useQuery<McpServer[]>({
    queryKey: ['/api/mcp-servers'],
    queryFn: async () => {
      const res = await fetch('/api/mcp-servers');
      if (!res.ok) throw new Error('Failed to fetch MCP servers');
      return res.json();
    }
  });

  const installMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await fetch('/api/mcp-servers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error('Failed to install server');
      return res.json();
    },
    onSuccess: () => {
      toast({ title: 'MCP Server Installed', description: 'The server is now available for agent mounting.' });
      queryClient.invalidateQueries({ queryKey: ['/api/mcp-servers'] });
    },
    onError: (err: any) => {
      toast({ title: 'Installation Failed', description: err.message, variant: 'destructive' });
    }
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number, status: string }) => {
      const res = await fetch(`/api/mcp-servers/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      if (!res.ok) throw new Error('Failed to update server');
      return res.json();
    },
    onSuccess: () => {
      toast({ title: 'Server Updated', description: 'Server status has been changed.' });
      queryClient.invalidateQueries({ queryKey: ['/api/mcp-servers'] });
    }
  });

  const handleInstallCatalogItem = (item: any) => {
    installMutation.mutate({
      name: item.name,
      description: item.description,
      command: item.command,
      args: item.args,
      transport: "stdio",
    });
  };

  const handleApproveSuggestion = (id: number) => {
    updateMutation.mutate({ id, status: 'active' });
  };

  const installedServerNames = servers.map(s => s.name);
  const suggestedServers = servers.filter(s => s.status === 'suggested');

  return (
    <div className="min-h-screen bg-background text-foreground p-8">
      <div className="max-w-6xl mx-auto space-y-8">
        
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-border pb-6">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <Sparkles className="w-8 h-8 text-blue-600 dark:text-blue-400" />
              <h1 className="text-4xl font-black tracking-tight">Dynamic MCP Marketplace</h1>
            </div>
            <p className="text-lg text-muted-foreground">
              Install and mount Model Context Protocol tools on the fly. 
              Agents will automatically utilize these tools via the Hub.
            </p>
          </div>
        </div>

        {/* Suggestions Inbox */}
        {suggestedServers.length > 0 && (
          <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50 rounded-xl p-6">
            <div className="flex items-center gap-2 mb-4 text-amber-800 dark:text-amber-400">
              <ShieldAlert className="w-5 h-5" />
              <h2 className="text-lg font-bold">Agent Tool Suggestions</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {suggestedServers.map(server => (
                <Card key={server.id} className="border-amber-200 dark:border-amber-800">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-md flex justify-between">
                      {server.name}
                      <Badge variant="outline" className="text-amber-600">Pending Review</Badge>
                    </CardTitle>
                    <CardDescription className="font-mono text-xs mt-2">
                      {server.command} {server.args?.join(" ")}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm">{server.description}</p>
                  </CardContent>
                  <CardFooter>
                    <Button onClick={() => handleApproveSuggestion(server.id)} className="w-full bg-amber-600 hover:bg-amber-700 text-foreground">
                      <CheckCircle className="w-4 h-4 mr-2" /> Approve & Install
                    </Button>
                  </CardFooter>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* Official Catalog */}
        <div>
          <h2 className="text-2xl font-bold mb-6">Official Tool Catalog</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {MCP_CATALOG.map((item, idx) => {
              const isInstalled = installedServerNames.includes(item.name);
              return (
                <Card key={idx} className={`relative overflow-hidden ${isInstalled ? 'border-emerald-500' : ''}`}>
                  {isInstalled && (
                    <div className="absolute top-0 right-0 bg-emerald-500 text-foreground text-[10px] font-bold px-3 py-1 uppercase tracking-wider rounded-bl-lg">
                      Installed
                    </div>
                  )}
                  <CardHeader>
                    <div className="mb-4 bg-muted w-16 h-16 rounded-2xl flex items-center justify-center">
                      {item.icon}
                    </div>
                    <CardTitle>{item.name}</CardTitle>
                    <CardDescription className="h-10 line-clamp-2">{item.description}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="bg-muted rounded p-3 text-xs font-mono text-muted-foreground break-all">
                      $ {item.command} {item.args.join(" ")}
                    </div>
                  </CardContent>
                  <CardFooter>
                    <Button 
                      onClick={() => handleInstallCatalogItem(item)} 
                      disabled={isInstalled || installMutation.isPending} 
                      className="w-full"
                      variant={isInstalled ? "secondary" : "default"}
                    >
                      {isInstalled ? (
                        <><CheckCircle className="w-4 h-4 mr-2" /> Active</>
                      ) : (
                        <><Download className="w-4 h-4 mr-2" /> Install Tool</>
                      )}
                    </Button>
                  </CardFooter>
                </Card>
              );
            })}
          </div>
        </div>

      </div>
    </div>
  );
}
