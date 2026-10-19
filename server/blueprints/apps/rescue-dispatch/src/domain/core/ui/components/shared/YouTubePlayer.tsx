import React from 'react';
import { Card } from "@domain-ui/core/ui/components/ui/card";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { ThumbsUp, ThumbsDown, MessageSquare } from 'lucide-react';
import { cn } from "@/lib/utils";

interface YouTubePlayerProps {
    videoId: string;
    timestamp?: number;
    title?: string;
    onRate?: (rating: number, reason?: string) => void;
    currentRating?: number;
}

export function YouTubePlayer({ videoId, timestamp = 0, title, onRate, currentRating }: YouTubePlayerProps) {
    const embedUrl = `https://www.youtube.com/embed/${videoId}?start=${timestamp}&autoplay=0`;

    return (
        <Card className="overflow-hidden border-none shadow-lg bg-black/5 dark:bg-black/40 my-4 max-w-2xl">
            {title && (
                <div className="px-4 py-2 bg-black/10 flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-tighter truncate max-w-[200px]">{title}</span>
                    <span className="text-[10px] opacity-60">ID: {videoId}</span>
                </div>
            )}

            <div className="aspect-video w-full bg-black/20">
                <iframe
                    width="100%"
                    height="100%"
                    src={embedUrl}
                    title={title || "YouTube video player"}
                    frameBorder="0"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    allowFullScreen
                    className="w-full h-full"
                />
            </div>

            <div className="p-3 flex items-center justify-between gap-4 border-t border-white/5">
                <div className="flex items-center gap-1.5">
                    <Button
                        variant="ghost"
                        size="icon"
                        className={cn("h-8 w-8 rounded-full transition-all", currentRating === 1 && "bg-green-500/20 text-green-500 scale-110")}
                        onClick={() => onRate?.(1)}
                        title="Helpful segment"
                    >
                        <ThumbsUp className="h-4 w-4" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        className={cn("h-8 w-8 rounded-full transition-all", currentRating === -1 && "bg-red-500/20 text-red-500 scale-110")}
                        onClick={() => onRate?.(-1)}
                        title="Irrelevant or bad clip"
                    >
                        <ThumbsDown className="h-4 w-4" />
                    </Button>
                </div>

                <Button
                    variant="link"
                    className="text-[10px] h-auto p-0 opacity-40 hover:opacity-100 flex items-center gap-1"
                    onClick={() => onRate?.(0, "comment")}
                >
                    <MessageSquare className="h-3 w-3" />
                    Give Detail
                </Button>
            </div>
        </Card>
    );
}
