import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { Switch } from "@domain-ui/core/ui/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@domain-ui/core/ui/components/ui/select";

interface YoutubeSyncConfigProps {
    config: any;
    onChange: (config: any) => void;
}

export default function YoutubeSyncConfig({ config, onChange }: YoutubeSyncConfigProps) {
    const { data: topicsData }: any = useQuery({ queryKey: ["/api/knowledge-topics"] });
    const topics = topicsData?.topics ?? topicsData ?? [];

    const set = (field: string, value: any) => onChange({ ...config, [field]: value });

    return (
        <div className="p-6 space-y-4">
            <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-widest">YouTube Playlist ID</Label>
                <Input
                    className="h-8 text-sm font-mono"
                    value={config.playlistId || ""}
                    onChange={(e) => set("playlistId", e.target.value)}
                    placeholder="PLrAXtmErZgOeidNTKLBVd_FTQ4E8Cz1i8"
                />
                <p className="text-[10px] text-muted-foreground">
                    The playlist ID from a YouTube URL: youtube.com/playlist?list=<strong>ID</strong>
                </p>
            </div>

            <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-widest">Max Videos</Label>
                <Input
                    type="number"
                    className="h-8 text-sm"
                    value={config.maxVideos ?? 50}
                    onChange={(e) => set("maxVideos", parseInt(e.target.value) || 50)}
                    min={1}
                    max={500}
                />
                <p className="text-[10px] text-muted-foreground">Maximum number of videos to sync from the playlist.</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
                <div className="flex items-center gap-3">
                    <Switch
                        checked={config.transcriptionEnabled !== false}
                        onCheckedChange={(v) => set("transcriptionEnabled", v)}
                    />
                    <div>
                        <Label className="text-xs font-bold uppercase tracking-widest">Transcription</Label>
                        <p className="text-[10px] text-muted-foreground">Extract auto-generated captions</p>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <Switch
                        checked={!!config.enrichmentEnabled}
                        onCheckedChange={(v) => set("enrichmentEnabled", v)}
                    />
                    <div>
                        <Label className="text-xs font-bold uppercase tracking-widest">AI Enrichment</Label>
                        <p className="text-[10px] text-muted-foreground">Summarize and extract key topics</p>
                    </div>
                </div>
            </div>

            <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-widest">Output Knowledge Topic</Label>
                <Select
                    value={config.knowledgeTopicId?.toString() || ""}
                    onValueChange={(v) => set("knowledgeTopicId", parseInt(v))}
                >
                    <SelectTrigger className="h-8 text-sm">
                        <SelectValue placeholder="Select knowledge topic..." />
                    </SelectTrigger>
                    <SelectContent>
                        {topics.map((t: any) => (
                            <SelectItem key={t.id} value={t.id.toString()}>{t.name}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground">Video metadata and transcripts will be ingested into this topic.</p>
            </div>
        </div>
    );
}
