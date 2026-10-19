
import { Button } from "@domain-ui/core/ui/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@domain-ui/core/ui/components/ui/dialog";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useMutation, useQuery } from "@tanstack/react-query";
import { BrainCircuit, Copy, Loader2, Search, Star } from "lucide-react";
import { useState } from "react";
import { ScrollArea } from "@domain-ui/core/ui/components/ui/scroll-area";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Switch } from "@domain-ui/core/ui/components/ui/switch";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@domain-ui/core/ui/components/ui/select";

export function TemplateGalleryDialog() {
    const [open, setOpen] = useState(false);
    const [selectedTemplate, setSelectedTemplate] = useState<any>(null);
    const [missionName, setMissionName] = useState("");
    const [searchQuery, setSearchQuery] = useState("");
    const [sourceFilter, setSourceFilter] = useState<"all" | "builtin" | "mine">("all");
    const { toast } = useToast();

    const { data: templates = [], isLoading } = useQuery<any[]>({
        queryKey: ["/api/missions/templates"],
        enabled: open,
    });

    const filteredTemplates = templates.filter((t) => {
        const matchesSearch =
            !searchQuery ||
            [t.name, t.description, t.config?.objective].some(
                (v) => v && String(v).toLowerCase().includes(searchQuery.toLowerCase())
            );
        const matchesSource =
            sourceFilter === "all" ||
            (sourceFilter === "builtin" && t.organizationId == null) ||
            (sourceFilter === "mine" && t.organizationId != null);
        return matchesSearch && matchesSource;
    });

    const [isScheduled, setIsScheduled] = useState(false);
    const [frequency, setFrequency] = useState("20min");

    const instantiateMutation = useMutation({
        mutationFn: async () => {
            let scheduleConfig = null;
            if (isScheduled) {
                if (frequency === "20min") {
                    scheduleConfig = { pattern: 1, patternString: { cron: "*/20 * * * *" } };
                } else if (frequency === "hourly") {
                    scheduleConfig = { pattern: 1, patternString: { cron: "0 * * * *" } };
                } else if (frequency === "daily") {
                    scheduleConfig = { pattern: 1, patternString: { cron: "0 9 * * *" } };
                } else if (frequency === "weekly") {
                    scheduleConfig = { pattern: 1, patternString: { cron: "0 9 * * 1" } };
                }
            }

            const res = await apiRequest("POST", `/api/missions/templates/${selectedTemplate.id}/instantiate`, {
                name: missionName,
                scheduleConfig
            });
            return res.json();
        },
        onSuccess: (newGroup) => {
            queryClient.invalidateQueries({ queryKey: ["/api/missions"] });
            toast({
                title: "Mission Launched",
                description: `Created new mission "${newGroup.name}" from template.`,
            });
            setOpen(false);
            setSelectedTemplate(null);
            setMissionName("");
        },
        onError: (error: any) => {
            toast({
                title: "Failed to create mission",
                description: error.message,
                variant: "destructive",
            });
        },
    });

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" className="gap-2 border-primary/30 hover:bg-primary/10 hover:text-primary">
                    <Copy className="w-4 h-4" />
                    Blueprints
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[800px] h-[600px] bg-background border-border text-foreground flex flex-col">
                <DialogHeader>
                    <DialogTitle>Mission Blueprints</DialogTitle>
                    <DialogDescription>
                        Launch a new mission pre-configured with objectives, roles, and member structures.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex-1 flex gap-6 min-h-0 pt-4">
                    {/* Left: Template List */}
                    <div className="w-1/2 flex flex-col gap-4">
                        <div className="flex gap-2">
                            <div className="relative flex-1">
                                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                                <Input
                                    placeholder="Search blueprints..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="pl-8 bg-card border-border"
                                />
                            </div>
                            <select
                                value={sourceFilter}
                                onChange={(e) => setSourceFilter(e.target.value as "all" | "builtin" | "mine")}
                                className="rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground"
                                aria-label="Filter blueprints by source"
                            >
                                <option value="all">All</option>
                                <option value="builtin">Built-in</option>
                                <option value="mine">My blueprints</option>
                            </select>
                        </div>
                        <ScrollArea className="flex-1 border border-border rounded-md bg-card/50 p-2">
                            {isLoading ? (
                                <div className="flex justify-center p-8">
                                    <Loader2 className="animate-spin text-muted-foreground" />
                                </div>
                            ) : filteredTemplates.length > 0 ? (
                                <div className="space-y-2">
                                    {filteredTemplates.map((template) => (
                                        <div
                                            key={template.id}
                                            onClick={() => {
                                                setSelectedTemplate(template);
                                                setMissionName(`Copy of ${template.name}`);
                                            }}
                                            className={`p-3 rounded-lg border cursor-pointer transition-all ${selectedTemplate?.id === template.id
                                                ? "bg-primary/20 border-primary"
                                                : "bg-card border-border hover:border-border"
                                                }`}
                                        >
                                            <div className="flex items-center justify-between mb-1">
                                                <h4 className="font-semibold text-sm">{template.name}</h4>
                                                <div className="flex items-center gap-1">
                                                    {template.organizationId == null && (
                                                        <Badge variant="secondary" className="text-[9px] h-4 px-1">
                                                            Built-in
                                                        </Badge>
                                                    )}
                                                    <Badge variant="outline" className="text-[10px] h-5">
                                                        {template.config?.type || "Mission"}
                                                    </Badge>
                                                    <Badge variant="secondary" className="text-[9px] h-4 px-1 bg-emerald-500/10 text-emerald-500 border-emerald-500/20">
                                                        v{(template as any).version || "1.0.0"}
                                                    </Badge>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-1 mt-1">
                                                {[...Array(5)].map((_, i) => (
                                                    <Star 
                                                        key={i} 
                                                        className={`w-3 h-3 ${i < ((template as any).starRating || 0) ? "fill-yellow-500 text-yellow-500" : "text-foreground"}`} 
                                                    />
                                                ))}
                                                <span className="text-[10px] text-muted-foreground ml-1">
                                                    {((template as any).performanceHistory as any[])?.length || 0} runs
                                                </span>
                                            </div>
                                            <p className="text-xs text-muted-foreground line-clamp-1 mt-1">
                                                {template.description}
                                            </p>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="text-center p-8 text-muted-foreground text-sm">
                                    {templates.length === 0
                                        ? "No blueprints found. Save a mission as a blueprint first."
                                        : "No blueprints match your search or filter."}
                                </div>
                            )}
                        </ScrollArea>
                    </div>

                    {/* Right: details & Launch */}
                    <div className="w-1/2 flex flex-col gap-4 border-l border-border pl-6">
                        {selectedTemplate ? (
                            <>
                                <div className="space-y-1">
                                    <h3 className="text-xl font-bold text-primary">{selectedTemplate.name}</h3>
                                    <p className="text-sm text-muted-foreground">{selectedTemplate.description}</p>
                                </div>

                                <Card className="bg-card/50 border-border">
                                    <CardHeader className="py-3">
                                        <CardTitle className="text-sm font-medium">Configuration Preview</CardTitle>
                                    </CardHeader>
                                    <CardContent className="py-2 space-y-2 text-sm">
                                        <div className="flex justify-between">
                                            <span className="text-muted-foreground">Objective:</span>
                                            <span className="truncate max-w-[200px]" title={selectedTemplate.config.objective}>
                                                {selectedTemplate.config.objective}
                                            </span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-muted-foreground">Role Structure:</span>
                                            <span>{selectedTemplate.config.members?.length || 0} Members</span>
                                        </div>
                                    </CardContent>
                                </Card>

                                <div className="mt-auto space-y-4">
                                    <div className="grid gap-2">
                                        <Label htmlFor="missionName">New Mission Name</Label>
                                        <Input
                                            id="missionName"
                                            value={missionName}
                                            onChange={(e) => setMissionName(e.target.value)}
                                            className="bg-card border-border focus:ring-primary"
                                        />
                                    </div>

                                    <div className="space-y-4 border-t border-border pt-4">
                                        <div className="flex items-center justify-between">
                                            <div className="space-y-0.5">
                                                <Label className="text-sm font-medium">Mission Scheduling</Label>
                                                <p className="text-xs text-muted-foreground">Enable automatic recurring runs.</p>
                                            </div>
                                            <Switch
                                                checked={isScheduled}
                                                onCheckedChange={setIsScheduled}
                                            />
                                        </div>

                                        {isScheduled && (
                                            <div className="space-y-2">
                                                <Label className="text-xs uppercase font-bold text-muted-foreground font-mono">Frequency</Label>
                                                <Select value={frequency} onValueChange={setFrequency}>
                                                    <SelectTrigger className="bg-card border-border">
                                                        <SelectValue placeholder="Select Frequency" />
                                                    </SelectTrigger>
                                                    <SelectContent className="bg-card border-border">
                                                        <SelectItem value="20min">Every 20 Minutes</SelectItem>
                                                        <SelectItem value="hourly">Every Hour</SelectItem>
                                                        <SelectItem value="daily">Daily</SelectItem>
                                                        <SelectItem value="weekly">Weekly</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                        )}
                                    </div>
                                    <Button
                                        className="w-full bg-primary hover:bg-primary/90"
                                        disabled={!missionName || instantiateMutation.isPending}
                                        onClick={() => instantiateMutation.mutate()}
                                    >
                                        {instantiateMutation.isPending ? (
                                            <>
                                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                                Launching...
                                            </>
                                        ) : (
                                            <>
                                                <BrainCircuit className="w-4 h-4 mr-2" />
                                                Launch Mission
                                            </>
                                        )}
                                    </Button>
                                </div>
                            </>
                        ) : (
                            <div className="h-full flex items-center justify-center text-muted-foreground text-sm italic">
                                Select a template to view details
                            </div>
                        )}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}

