import React, { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import {
    Building2, Plus, Settings2, Trash2, Globe, Sparkles,
    Activity, ArrowRight, ArrowLeft, ShieldCheck, Mail, Users, Copy, Code, CheckCircle2, User, Eye, AlertTriangle
} from "lucide-react";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@domain-ui/core/ui/components/ui/dialog";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Switch } from "@domain-ui/core/ui/components/ui/switch";
import { Alert, AlertDescription, AlertTitle } from "@domain-ui/core/ui/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@domain-ui/core/ui/components/ui/tabs";
import { ScrollArea } from "@domain-ui/core/ui/components/ui/scroll-area";
import { format } from "date-fns";

interface ProspectProperty {
    id: number;
    uid: string;
    name: string;
    domain: string | null;
    personaAgentId: string | null;
    personaPromptOverride: string | null;
    uiConfig: any;
    deanonConfig: any;
    createdAt: string;
}

export default function ProspectingDashboard() {
    const { toast } = useToast();
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [selectedPropertyId, setSelectedPropertyId] = useState<number | null>(() => {
        if (typeof window !== "undefined") {
            const p = new URLSearchParams(window.location.search).get("propertyId");
            return p ? Number(p) : null;
        }
        return null;
    });
    const [activeTab, setActiveTab] = useState<string>(() => {
        if (typeof window !== "undefined") {
            return new URLSearchParams(window.location.search).get("tab") || "leads";
        }
        return "leads";
    });
    const [initialLeadId, setInitialLeadId] = useState<number | null>(() => {
        if (typeof window !== "undefined") {
            const l = new URLSearchParams(window.location.search).get("leadId");
            return l ? Number(l) : null;
        }
        return null;
    });
    const [newProperty, setNewProperty] = useState({ name: "", domain: "", personaAgentId: "sales-pilot-agent" });

    React.useEffect(() => {
        const handleLocationSync = () => {
            const params = new URLSearchParams(window.location.search);
            const p = params.get("propertyId");
            if (p) setSelectedPropertyId(Number(p));
            const t = params.get("tab");
            if (t) setActiveTab(t);
            const l = params.get("leadId");
            if (l) setInitialLeadId(Number(l));
        };
        window.addEventListener("popstate", handleLocationSync);
        return () => window.removeEventListener("popstate", handleLocationSync);
    }, []);

    const { data: properties = [], isLoading } = useQuery<ProspectProperty[]>({
        queryKey: ["/api/prospecting/properties"],
    });

    const createMutation = useMutation({
        mutationFn: async (data: typeof newProperty) => {
            const res = await fetch("/api/prospecting/properties", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(data)
            });
            if (!res.ok) throw new Error(await res.text());
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/prospecting/properties"] });
            setIsCreateOpen(false);
            setNewProperty({ name: "", domain: "", personaAgentId: "sales-pilot-agent" });
            toast({ title: "Property Created", description: "Your new property is ready." });
        },
        onError: (err: Error) => {
            toast({ title: "Failed to create", description: err.message, variant: "destructive" });
        }
    });

    const deleteMutation = useMutation({
        mutationFn: async (id: number) => {
            const res = await fetch(`/api/prospecting/properties/${id}`, { method: "DELETE" });
            if (!res.ok) throw new Error(await res.text());
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/prospecting/properties"] });
            toast({ title: "Property Deleted" });
        }
    });

    if (isLoading) {
        return <div className="p-8 text-center text-muted-foreground animate-pulse">Loading Identity Bridge...</div>;
    }

    return (
        <div className="p-6 md:p-12 space-y-8 w-full max-w-full" data-testid="identity-bridge-dashboard">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-2" data-testid="identity-bridge-header">
                        <ShieldCheck className="w-8 h-8 text-primary" />
                        Enterprise Identity Bridge
                    </h1>
                    <p className="text-muted-foreground mt-2">
                        Manage your prospecting properties, federated identities, and anonymous-to-known bridges.
                    </p>
                </div>

                <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                    <DialogTrigger asChild>
                        <Button className="gap-2 bg-primary text-primary-foreground shadow-sm">
                            <Plus className="w-4 h-4" /> New Property
                        </Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Create Prospecting Property</DialogTitle>
                            <DialogDescription>
                                A property represents a website or app where the JS Harness is installed.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4 py-4">
                            <div className="space-y-2">
                                <Label>Property Name</Label>
                                <Input placeholder="e.g. Marketing Site" value={newProperty.name} onChange={e => setNewProperty({ ...newProperty, name: e.target.value })} />
                            </div>
                            <div className="space-y-2">
                                <Label>Domain (Optional)</Label>
                                <Input placeholder="e.g. https://marketing.example.com" value={newProperty.domain} onChange={e => setNewProperty({ ...newProperty, domain: e.target.value })} />
                            </div>
                            <div className="space-y-2">
                                <Label>Default Co-pilot Persona</Label>
                                <Input placeholder="Agent ID" value={newProperty.personaAgentId} onChange={e => setNewProperty({ ...newProperty, personaAgentId: e.target.value })} />
                                <p className="text-xs text-muted-foreground">The agent that handles interventions on this property.</p>
                            </div>
                        </div>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
                            <Button
                                onClick={() => createMutation.mutate(newProperty)}
                                disabled={!newProperty.name || createMutation.isPending}
                                className="bg-primary text-primary-foreground hover:bg-primary/90"
                            >
                                {createMutation.isPending ? "Creating..." : "Create Property"}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </div>

            {properties.length === 0 ? (
                <Alert className="border-border bg-card">
                    <Building2 className="w-5 h-5 text-primary" />
                    <AlertTitle className="text-foreground">No Properties Found</AlertTitle>
                    <AlertDescription className="text-muted-foreground">
                        Create your first property to generate a JS Harness snipped and start tracking prospects.
                        You can create up to 5 properties per organization.
                    </AlertDescription>
                </Alert>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {properties.map(property => (
                        <Card key={property.id} data-testid="identity-bridge-property-card" className="group border-border/50 hover:border-primary/50 hover:shadow-lg hover:shadow-primary/10 transition-all duration-300 relative overflow-hidden backdrop-blur-sm bg-card/95">
                            <div className="absolute top-0 right-0 p-4 opacity-0 group-hover:opacity-100 transition-opacity flex gap-2">
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => {
                                    if (confirm("Are you sure you want to delete this property?")) {
                                        deleteMutation.mutate(property.id);
                                    }
                                }}>
                                    <Trash2 className="w-4 h-4" />
                                </Button>
                            </div>

                            <CardHeader className="pb-3">
                                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-3">
                                    <Globe className="w-5 h-5 text-primary" />
                                </div>
                                <CardTitle className="text-xl flex items-center gap-2">
                                    {property.name}
                                </CardTitle>
                                <CardDescription className="flex items-center gap-1.5 font-mono text-xs">
                                    {property.domain || 'No domain configured'}
                                </CardDescription>
                            </CardHeader>

                            <CardContent className="space-y-4">
                                <div className="bg-muted/50 rounded-md p-3 font-mono text-xs overflow-x-auto border border-border/50">
                                    <div className="text-muted-foreground mb-1 font-sans font-medium text-[10px] uppercase tracking-wider">Property UID</div>
                                    {property.uid}
                                </div>

                                <div className="flex flex-col gap-2">
                                    <div className="flex items-center justify-between text-sm">
                                        <span className="text-muted-foreground flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5" /> Persona</span>
                                        <Badge variant="secondary" className="font-mono text-[10px] bg-primary/10 text-primary hover:bg-primary/20">
                                            {property.personaAgentId}
                                        </Badge>
                                    </div>
                                    <div className="flex items-center justify-between text-sm">
                                        <span className="text-muted-foreground flex items-center gap-1.5"><Activity className="w-3.5 h-3.5" /> JS Harness</span>
                                        <span className="text-emerald-500 text-xs font-medium flex items-center gap-1">Active</span>
                                    </div>
                                </div>
                            </CardContent>

                            <CardFooter className="pt-2 pb-4">
                                <Button variant="outline" data-testid="identity-bridge-details-btn" className="w-full gap-2 text-primary hover:bg-primary/10 border-primary/20" onClick={() => setSelectedPropertyId(property.id)}>
                                    <Eye className="w-4 h-4" /> View Details & Leads
                                </Button>
                            </CardFooter>
                        </Card>
                    ))}
                </div>
            )}

            <PropertyDetailsModal
                propertyId={selectedPropertyId}
                initialTab={activeTab}
                initialLeadId={initialLeadId}
                onClose={() => {
                    setSelectedPropertyId(null);
                    setInitialLeadId(null);
                }}
            />
        </div>
    );
}

function PropertyDetailsModal({ propertyId, initialTab, initialLeadId, onClose }: { propertyId: number | null, initialTab?: string, initialLeadId?: number | null, onClose: () => void }) {
    const { toast } = useToast();
    const [copied, setCopied] = useState(false);

    const { data: properties } = useQuery<ProspectProperty[]>({
        queryKey: ["/api/prospecting/properties"],
    });

    const property = properties?.find(p => p.id === propertyId);
    const [selectedLeadId, setSelectedLeadId] = useState<number | null>(initialLeadId || null);
    const [tab, setTab] = useState(initialTab || "leads");

    React.useEffect(() => {
        if (initialTab) {
            setTab(initialTab);
        }
    }, [initialTab]);

    React.useEffect(() => {
        if (initialLeadId != null) {
            setSelectedLeadId(initialLeadId);
        }
    }, [initialLeadId]);

    const { data: leadsInfo = [], isLoading: isLoadingLeads } = useQuery<any[]>({
        queryKey: [`/api/prospecting/properties/${propertyId}/leads`],
        enabled: !!propertyId
    });

    React.useEffect(() => {
        if (tab === "timeline" && !selectedLeadId && leadsInfo.length > 0) {
            setSelectedLeadId(leadsInfo[0].lead.id);
        }
    }, [tab, selectedLeadId, leadsInfo]);

    if (!property) return null;

    const snippet = `<script src="${window.location.origin}/oddjob-prospector.js" data-property-uid="${property.uid}"></script>`;

    const copyToClipboard = () => {
        navigator.clipboard.writeText(snippet);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        toast({ title: "Snippet Copied", description: "Integration snippet copied to clipboard." });
    };

    const selectedLead = leadsInfo.find(l => l.lead.id === selectedLeadId);

    return (
        <Dialog open={!!propertyId} onOpenChange={(open) => {
            if (!open) {
                onClose();
                setSelectedLeadId(null);
            }
        }}>
            <DialogContent className="max-w-5xl max-h-[90vh] overflow-hidden flex flex-col p-0 border-none shadow-2xl">
                <div className="bg-primary p-6 text-primary-foreground">
                    <DialogHeader>
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-foreground/20 rounded-lg backdrop-blur-md">
                                <Globe className="w-6 h-6 text-primary-foreground" />
                            </div>
                            <div>
                                <DialogTitle className="text-2xl font-bold text-primary-foreground">{property.name}</DialogTitle>
                                <DialogDescription className="text-primary-foreground/80 flex items-center gap-2 mt-1">
                                    <Badge variant="outline" className="text-primary-foreground border-primary-foreground/30 font-mono text-[10px] uppercase">
                                        ID: {property.uid.substring(0, 8)}...
                                    </Badge>
                                    <span className="opacity-70">|</span>
                                    <span>{property.domain || 'All Domains'}</span>
                                </DialogDescription>
                            </div>
                        </div>
                    </DialogHeader>
                </div>

                <Tabs value={tab} onValueChange={setTab} className="flex-1 flex flex-col">
                    <div className="px-6 border-b bg-muted/30">
                        <TabsList className="bg-transparent gap-6 h-14 p-0">
                            <TabsTrigger value="leads" data-testid="identity-bridge-tab-leads" className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none h-14 text-sm font-medium transition-none">
                                <Users className="w-4 h-4 mr-2" /> Identified Leads
                            </TabsTrigger>
                            <TabsTrigger
                                value="timeline"
                                data-testid="identity-bridge-tab-timeline"
                                onClick={() => {
                                    if (!selectedLeadId && leadsInfo.length > 0) {
                                        setSelectedLeadId(leadsInfo[0].lead.id);
                                    }
                                }}
                                className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none h-14 text-sm font-medium transition-none"
                            >
                                <Activity className="w-4 h-4 mr-2" /> Activity Timeline
                            </TabsTrigger>
                            <TabsTrigger value="setup" data-testid="identity-bridge-tab-setup" className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none h-14 text-sm font-medium transition-none">
                                <Code className="w-4 h-4 mr-2" /> Setup Guide
                            </TabsTrigger>
                            <TabsTrigger value="deanon" data-testid="identity-bridge-tab-deanon" className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none h-14 text-sm font-medium transition-none">
                                <Eye className="w-4 h-4 mr-2" /> De-anonymization
                            </TabsTrigger>
                        </TabsList>
                    </div>

                    <ScrollArea className="flex-1">
                        <div className="p-6 h-full">
                            <TabsContent value="leads" className="m-0 focus-visible:outline-none">
                                {isLoadingLeads ? (
                                    <div className="flex flex-col items-center justify-center py-12 gap-4">
                                        <div className="w-12 h-12 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
                                        <p className="text-muted-foreground font-medium animate-pulse">Syncing identities...</p>
                                    </div>
                                ) : leadsInfo.length === 0 ? (
                                    <div className="text-center py-20 border-2 border-dashed rounded-xl bg-muted/10">
                                        <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
                                            <Users className="w-8 h-8 text-muted-foreground" />
                                        </div>
                                        <h4 className="text-lg font-semibold">No prospects tracked yet</h4>
                                        <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
                                            Install the JS snippet to start capturing behavioral data and resolving enterprise identities.
                                        </p>
                                        <Button variant="outline" className="mt-6" onClick={() => {
                                            document.querySelector('[value="setup"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                                        }}>
                                            Go to Setup Guide
                                        </Button>
                                    </div>
                                ) : (
                                    <div className="border rounded-xl shadow-sm bg-card overflow-hidden" data-testid="identity-bridge-leads-table">
                                        <table className="w-full text-sm text-left">
                                            <thead className="bg-muted/50 border-b">
                                                <tr>
                                                    <th className="px-5 py-4 font-semibold text-muted-foreground uppercase text-[11px] tracking-wider">Status</th>
                                                    <th className="px-5 py-4 font-semibold text-muted-foreground uppercase text-[11px] tracking-wider">Identity & Enterprise</th>
                                                    <th className="px-5 py-4 font-semibold text-muted-foreground uppercase text-[11px] tracking-wider">S.C.O.R.E.</th>
                                                    <th className="px-5 py-4 font-semibold text-muted-foreground uppercase text-[11px] tracking-wider">Last Sync</th>
                                                    <th className="px-5 py-4 font-semibold text-muted-foreground uppercase text-[11px] tracking-wider text-right">Actions</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-border/60">
                                                {leadsInfo.map((item, i) => {
                                                    const bant = item.lead.bantScore || { S: 0, C: 0, O: 0, R: 0, E: 0 };
                                                    const isSelected = selectedLeadId === item.lead.id;
                                                    return (
                                                        <tr
                                                            key={i}
                                                            data-testid={`identity-bridge-lead-row-${item.lead.id}`}
                                                            className={`cursor-pointer transition-colors ${isSelected ? 'bg-primary/5' : 'hover:bg-muted/30'}`}
                                                            onClick={() => {
                                                                setSelectedLeadId(item.lead.id);
                                                                setTab("timeline");
                                                            }}
                                                            title="Click to view full engagement history"
                                                        >
                                                            <td className="px-5 py-5">
                                                                <Badge variant={item.lead.status === "identified" ? "default" : "secondary"} className={item.lead.status === "identified" ? "bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 border-emerald-200" : ""}>
                                                                    {item.lead.status}
                                                                </Badge>
                                                            </td>
                                                            <td className="px-5 py-5">
                                                                <div className="flex flex-col gap-1.5">
                                                                    <div className="flex items-center gap-2 font-medium">
                                                                        {item.profile.metadata?.email || item.profile.userId || (
                                                                            <span className="text-muted-foreground font-mono">{item.profile.uid.substring(2, 10)}...</span>
                                                                        )}
                                                                    </div>
                                                                    {item.profile.metadata?.company && (
                                                                        <div className="flex items-center gap-2 text-xs text-primary font-semibold bg-primary/10 w-fit px-2 py-0.5 rounded border border-primary/20">
                                                                            <Building2 className="w-3.5 h-3.5" />
                                                                            {item.profile.metadata.company.name}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </td>
                                                            <td className="px-5 py-5">
                                                                <div className="flex gap-3 text-xs">
                                                                    {['S', 'C', 'O', 'R', 'E'].map(l => (
                                                                        <div key={l} className="flex flex-col items-center">
                                                                            <span className="text-[10px] text-muted-foreground font-bold">{l}</span>
                                                                            <span className={`font-mono font-bold ${bant[l] > 5 ? 'text-primary' : bant[l] > 0 ? 'text-foreground' : 'text-muted-foreground/40'}`}>
                                                                                {bant[l]}
                                                                            </span>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            </td>
                                                            <td className="px-5 py-5 text-xs text-muted-foreground">
                                                                {format(new Date(item.profile.lastSeenAt), "MMM d, h:mm a")}
                                                            </td>
                                                            <td className="px-5 py-5 text-right">
                                                                <Button
                                                                    variant="ghost"
                                                                    size="sm"
                                                                    className="h-8 w-8 p-0 hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors"
                                                                    data-testid={`identity-bridge-lead-action-${item.lead.id}`}
                                                                    title="View Lead Activity Timeline"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        setSelectedLeadId(item.lead.id);
                                                                        setTab("timeline");
                                                                    }}
                                                                >
                                                                    <ArrowRight className="w-4 h-4" />
                                                                </Button>
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </TabsContent>

                            <TabsContent value="timeline" className="m-0 focus-visible:outline-none h-full">
                                {selectedLead ? (
                                    <LeadTimeline lead={selectedLead} onBack={() => setTab("leads")} />
                                ) : leadsInfo.length > 0 ? (
                                    <LeadTimeline lead={leadsInfo[0]} onBack={() => setTab("leads")} />
                                ) : (
                                    <div className="text-center py-20 border-2 border-dashed rounded-xl bg-muted/10">
                                        <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
                                            <Activity className="w-8 h-8 text-muted-foreground" />
                                        </div>
                                        <h4 className="text-lg font-semibold">No lead activity recorded</h4>
                                        <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
                                            No identified leads yet for this property. Install the JS harness or trigger a test submission.
                                        </p>
                                    </div>
                                )}
                            </TabsContent>

                            <TabsContent value="setup" className="m-0 focus-visible:outline-none">
                                <div className="space-y-6">
                                    <Alert className="bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-900">
                                        <Sparkles className="w-4 h-4 text-amber-600" />
                                        <AlertTitle className="text-amber-800 dark:text-amber-400 font-bold">Proactive Co-pilot Enabled</AlertTitle>
                                        <AlertDescription className="text-amber-700 dark:text-amber-500">
                                            Once installed, the co-pilot will automatically track BANT signals and themes using the <strong>{property.personaAgentId}</strong> persona.
                                        </AlertDescription>
                                    </Alert>

                                    <div className="space-y-3">
                                        <h3 className="text-lg font-semibold flex items-center gap-2">
                                            <Code className="w-5 h-5 text-muted-foreground" />
                                            Copy Integration Snippet
                                        </h3>
                                        <p className="text-sm text-muted-foreground">
                                            Install this script in the <code>&lt;head&gt;</code> tag. It handles batched event ingestion and identity synchronization.
                                        </p>
                                        <div className="relative group" data-testid="identity-bridge-snippet-box">
                                            <pre className="bg-background text-emerald-400 p-6 rounded-xl overflow-x-auto text-[13px] font-mono border border-border shadow-xl">
                                                <code>{snippet}</code>
                                            </pre>
                                            <Button
                                                size="sm"
                                                variant="secondary"
                                                className="absolute top-4 right-4 h-9 gap-2 shadow-lg"
                                                onClick={copyToClipboard}
                                            >
                                                {copied ? <><CheckCircle2 className="w-4 h-4 text-emerald-500" /> Copied</> : <><Copy className="w-4 h-4" /> Copy Snippet</>}
                                            </Button>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4">
                                        <Card className="bg-muted/30">
                                            <CardHeader className="pb-2">
                                                <CardTitle className="text-sm">Identify API</CardTitle>
                                            </CardHeader>
                                            <CardContent>
                                                <p className="text-xs text-muted-foreground leading-relaxed">
                                                    Connect anonymous visitors to known users by calling <code>window.OddjobProspector.identify(userId, metadata)</code> upon login or form submission.
                                                </p>
                                            </CardContent>
                                        </Card>
                                        <Card className="bg-muted/30">
                                            <CardHeader className="pb-2">
                                                <CardTitle className="text-sm">Spatial Intervention</CardTitle>
                                            </CardHeader>
                                            <CardContent>
                                                <p className="text-xs text-muted-foreground leading-relaxed">
                                                    Use the mission explorer to define 'intervention rules' that trigger highlights or prompts on specific selectors.
                                                </p>
                                            </CardContent>
                                        </Card>
                                    </div>
                                </div>
                            </TabsContent>

                            <TabsContent value="deanon" className="m-0 focus-visible:outline-none">
                                <DeanonConfigEditor property={property} />
                            </TabsContent>
                        </div>
                    </ScrollArea>
                </Tabs>
            </DialogContent>
        </Dialog>
    );
}

/** Per-property de-anonymization rules editor (writes deanonConfig via PUT). */
function DeanonConfigEditor({ property }: { property: ProspectProperty }) {
    const { toast } = useToast();
    const { data: enrichment } = useQuery<{ configured: boolean; providers: string[] }>({
        queryKey: ["/api/prospecting/enrichment-status"],
    });
    const cfg = property.deanonConfig || {};
    const toList = (a?: string[]) => (Array.isArray(a) ? a.join(", ") : "");
    const fromList = (s: string) => s.split(",").map(x => x.trim()).filter(Boolean);

    const [enabled, setEnabled] = useState<boolean>(cfg.enabled !== false);
    const [providerChain, setProviderChain] = useState<string>(toList(cfg.providerChain));
    const [excludeIps, setExcludeIps] = useState<string>(toList(cfg.excludeIpPrefixes));
    const [minConfidence, setMinConfidence] = useState<string>(cfg.minConfidence != null ? String(cfg.minConfidence) : "");
    const [trigger, setTrigger] = useState<string>(cfg.trigger || "first_event");
    const [scoreThreshold, setScoreThreshold] = useState<string>(cfg.scoreThreshold != null ? String(cfg.scoreThreshold) : "");
    const [industries, setIndustries] = useState<string>(toList(cfg.icp?.industries));
    const [countries, setCountries] = useState<string>(toList(cfg.icp?.countries));
    const [minEmp, setMinEmp] = useState<string>(cfg.icp?.minEmployees != null ? String(cfg.icp.minEmployees) : "");
    const [maxEmp, setMaxEmp] = useState<string>(cfg.icp?.maxEmployees != null ? String(cfg.icp.maxEmployees) : "");

    const save = useMutation({
        mutationFn: async () => {
            const num = (s: string) => (s.trim() === "" ? undefined : Number(s));
            const icp: any = {};
            if (fromList(industries).length) icp.industries = fromList(industries);
            if (fromList(countries).length) icp.countries = fromList(countries);
            if (num(minEmp) != null) icp.minEmployees = num(minEmp);
            if (num(maxEmp) != null) icp.maxEmployees = num(maxEmp);
            const deanonConfig: any = {
                enabled,
                ...(fromList(providerChain).length ? { providerChain: fromList(providerChain) } : {}),
                ...(fromList(excludeIps).length ? { excludeIpPrefixes: fromList(excludeIps) } : {}),
                ...(num(minConfidence) != null ? { minConfidence: num(minConfidence) } : {}),
                trigger,
                ...(trigger === "score_threshold" && num(scoreThreshold) != null ? { scoreThreshold: num(scoreThreshold) } : {}),
                ...(Object.keys(icp).length ? { icp } : {}),
            };
            const res = await fetch(`/api/prospecting/properties/${property.id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ deanonConfig }),
            });
            if (!res.ok) throw new Error(await res.text());
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/prospecting/properties"] });
            toast({ title: "De-anonymization rules saved" });
        },
        onError: (err: Error) => toast({ title: "Failed to save", description: err.message, variant: "destructive" }),
    });

    const field = "text-sm";
    return (
        <div className="space-y-6 max-w-2xl">
            {enrichment && !enrichment.configured && (
                <Alert variant="destructive">
                    <AlertTriangle className="w-4 h-4" />
                    <AlertTitle>No enrichment provider connected</AlertTitle>
                    <AlertDescription className="text-xs">
                        De-anonymization can't resolve visitor IPs to companies until an enrichment tool is connected.
                        Add a Clearbit, ZoomInfo, or reverse-IP MCP server under <strong>Integrations</strong>, then these rules take effect.
                        Event tracking and scoring still work without it.
                    </AlertDescription>
                </Alert>
            )}
            {enrichment && enrichment.configured && (
                <Alert>
                    <CheckCircle2 className="w-4 h-4" />
                    <AlertTitle>Enrichment provider connected</AlertTitle>
                    <AlertDescription className="text-xs">
                        Available: {enrichment.providers.join(", ")}.
                    </AlertDescription>
                </Alert>
            )}

            <Alert>
                <Eye className="w-4 h-4" />
                <AlertTitle>De-anonymization rules</AlertTitle>
                <AlertDescription className="text-xs">
                    Resolves anonymous visitor IPs to companies via a connected enrichment tool (Clearbit / ZoomInfo / reverse-IP MCP).
                    Rules below control which providers run, which visitors get enriched, and which companies are surfaced. Leave a field blank to use defaults.
                </AlertDescription>
            </Alert>

            <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                    <Label className="text-sm font-medium">Enrichment enabled</Label>
                    <p className="text-xs text-muted-foreground">Master switch for this property.</p>
                </div>
                <Switch checked={enabled} onCheckedChange={setEnabled} />
            </div>

            <div className="grid gap-2">
                <Label className={field}>Provider priority chain</Label>
                <Input value={providerChain} onChange={e => setProviderChain(e.target.value)} placeholder="clearbit, zoominfo, reverse_ip" disabled={!enabled} />
                <p className="text-xs text-muted-foreground">Comma-separated MCP tool name fragments, tried in order until one returns a match. Blank = default chain.</p>
            </div>

            <div className="grid gap-2">
                <Label className={field}>Exclude IP prefixes</Label>
                <Input value={excludeIps} onChange={e => setExcludeIps(e.target.value)} placeholder="66.249., 10., 203.0.113." disabled={!enabled} />
                <p className="text-xs text-muted-foreground">Skip these IP prefixes (bots, datacenters, your own offices). Localhost/private are always skipped.</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                    <Label className={field}>Min confidence (0–1)</Label>
                    <Input type="number" step="0.05" min="0" max="1" value={minConfidence} onChange={e => setMinConfidence(e.target.value)} placeholder="e.g. 0.7" disabled={!enabled} />
                </div>
                <div className="grid gap-2">
                    <Label className={field}>Enrich when</Label>
                    <select className="h-10 rounded-md border bg-background px-3 text-sm" value={trigger} onChange={e => setTrigger(e.target.value)} disabled={!enabled}>
                        <option value="first_event">First event</option>
                        <option value="score_threshold">Intent score ≥ threshold</option>
                    </select>
                </div>
            </div>

            {trigger === "score_threshold" && (
                <div className="grid gap-2">
                    <Label className={field}>Score threshold (total S.C.O.R.E.)</Label>
                    <Input type="number" min="0" value={scoreThreshold} onChange={e => setScoreThreshold(e.target.value)} placeholder="e.g. 5" disabled={!enabled} />
                </div>
            )}

            <div className="rounded-lg border p-4 space-y-4">
                <div className="flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-primary" />
                    <Label className="text-sm font-medium">ICP filter (only surface matching companies)</Label>
                </div>
                <div className="grid gap-2">
                    <Label className={field}>Industries</Label>
                    <Input value={industries} onChange={e => setIndustries(e.target.value)} placeholder="software, fintech, healthcare" disabled={!enabled} />
                </div>
                <div className="grid gap-2">
                    <Label className={field}>Countries</Label>
                    <Input value={countries} onChange={e => setCountries(e.target.value)} placeholder="US, United States, CA" disabled={!enabled} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <div className="grid gap-2">
                        <Label className={field}>Min employees</Label>
                        <Input type="number" min="0" value={minEmp} onChange={e => setMinEmp(e.target.value)} placeholder="e.g. 50" disabled={!enabled} />
                    </div>
                    <div className="grid gap-2">
                        <Label className={field}>Max employees</Label>
                        <Input type="number" min="0" value={maxEmp} onChange={e => setMaxEmp(e.target.value)} placeholder="e.g. 5000" disabled={!enabled} />
                    </div>
                </div>
            </div>

            <div className="flex justify-end">
                <Button onClick={() => save.mutate()} disabled={save.isPending} className="gap-2">
                    <CheckCircle2 className="w-4 h-4" /> {save.isPending ? "Saving…" : "Save rules"}
                </Button>
            </div>
        </div>
    );
}

function LeadTimeline({ lead, onBack }: { lead: any; onBack?: () => void }) {
    const { data: events = [], isLoading } = useQuery<any[]>({
        queryKey: [`/api/prospecting/leads/${lead.lead.id}/events`],
    });

    if (isLoading) return <div className="text-center py-12 animate-pulse">Retrieving behavioral digital twin...</div>;

    return (
        <div className="space-y-8 max-w-2xl mx-auto py-4">
            <div className="flex items-center justify-between border-b pb-4 mb-8">
                <div className="flex items-center gap-3">
                    {onBack && (
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={onBack}
                            className="h-9 px-3 gap-1.5 text-xs font-semibold"
                            data-testid="identity-bridge-timeline-back-btn"
                        >
                            <ArrowLeft className="w-3.5 h-3.5" /> Back to Leads
                        </Button>
                    )}
                    <div>
                        <h3 className="text-xl font-bold flex items-center gap-2">
                            <Activity className="w-5 h-5 text-primary" />
                            Engagement Timeline
                        </h3>
                        <p className="text-sm text-muted-foreground">
                            Session history for <strong>{lead.profile.metadata?.email || lead.profile.userId || lead.profile.uid.substring(0, 15)}</strong>
                            {lead.profile.metadata?.company && (
                                <span className="ml-2 text-xs text-primary font-semibold">({lead.profile.metadata.company.name})</span>
                            )}
                        </p>
                    </div>
                </div>
                <Badge variant="outline" className="h-fit">
                    {events.length} Events Total
                </Badge>
            </div>

            <div className="relative space-y-6 before:absolute before:inset-0 before:ml-5 before:-translate-x-px before:h-full before:w-0.5 before:bg-gradient-to-b before:from-primary/50 before:via-primary/20 before:to-transparent">
                {events.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground italic">No historical events recorded yet for this lead.</div>
                ) : events.map((event, i) => (
                    <div key={i} className="relative flex items-start gap-6 group">
                        <div className="absolute left-0 mt-1.5 w-10.5 h-10.5 rounded-full border-4 border-background bg-primary flex items-center justify-center shrink-0 z-10 shadow-sm group-hover:scale-110 transition-transform">
                            {event.activity === 'page_view' && <Eye className="w-5 h-5 text-primary-foreground" />}
                            {event.activity === 'click' && <CheckCircle2 className="w-5 h-5 text-primary-foreground" />}
                            {event.activity === 'dwell' && <Activity className="w-5 h-5 text-primary-foreground" />}
                            {!['page_view', 'click', 'dwell'].includes(event.activity) && <Sparkles className="w-5 h-5 text-primary-foreground" />}
                        </div>
                        <div className="ml-12 pt-1.5 flex-1 pb-6 border-b border-border/40 group-last:border-none">
                            <div className="flex items-center justify-between gap-4 mb-2">
                                <span className="font-bold text-base capitalize">{event.activity.replace('_', ' ')}</span>
                                <time className="text-xs text-muted-foreground font-medium bg-muted px-2 py-1 rounded">
                                    {format(new Date(event.createdAt), "h:mm:ss a")}
                                </time>
                            </div>
                            <div className="bg-muted/30 rounded-lg p-3 border border-border/50">
                                <p className="text-sm font-mono text-primary truncate mb-2">
                                    {event.url}
                                </p>
                                {event.payload && (
                                    <div className="grid grid-cols-2 gap-2 text-[10px] uppercase font-bold tracking-tight">
                                        {Object.entries(event.payload).slice(0, 4).map(([k, v]) => (
                                            <div key={k} className="flex justify-between items-center bg-card p-1.5 rounded border border-border/50">
                                                <span className="text-muted-foreground">{k}</span>
                                                <span className="text-foreground max-w-[80px] truncate">{String(v)}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

