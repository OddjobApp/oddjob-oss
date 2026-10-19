import React, { useState } from "react";
import { Tv, Radio, Video, Signal } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "../ui/card.js";
import { Badge } from "../ui/badge.js";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../ui/tabs.js";
import { VideoPlayer } from "../ui/video-player.js";
import { AudioPlayer } from "../ui/audio-player.js";

export interface PlatformMediaPlayerBlockProps {
  title?: string;
  subtitle?: string;
  videoSrc?: string;
  videoTitle?: string;
  audioSrc?: string;
  audioTitle?: string;
  channelFrequency?: string;
  activeFeedType?: "video" | "audio";
}

/**
 * `videoSrc`/`audioSrc` deliberately have no default. They previously pointed at
 * third-party sample media (commondatastorage.googleapis.com, soundhelix.com),
 * which fails on any offline or CSP-restricted deploy and reads as a working
 * feed when nothing is wired. With no source the block says so instead.
 */
export function PlatformMediaPlayerBlock({
  title = "Comms & Surveillance Feed",
  subtitle = "Multimedia stream wrapper around the VideoPlayer & AudioPlayer primitives",
  videoSrc,
  videoTitle = "Video feed",
  audioSrc,
  audioTitle = "Audio channel",
  channelFrequency,
  activeFeedType = "video"
}: PlatformMediaPlayerBlockProps) {
  const [selectedTab, setSelectedTab] = useState<string>(activeFeedType);

  const NoSource = ({ kind }: { kind: string }) => (
    <div className="p-8 rounded-2xl border border-dashed border-border/60 bg-muted/10 flex flex-col items-center justify-center gap-2 text-center">
      <Signal className="w-6 h-6 text-muted-foreground" />
      <p className="text-xs font-bold text-foreground">No {kind} source configured</p>
      <p className="text-[11px] text-muted-foreground max-w-xs">
        Pass a <code className="font-mono">{kind === "video" ? "videoSrc" : "audioSrc"}</code> prop to stream a feed here.
      </p>
    </div>
  );

  return (
    <Card className="border-border/60 bg-card/40 backdrop-blur-md shadow-xl overflow-hidden">
      <CardHeader className="p-5 border-b border-border/40 bg-muted/20">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-primary/10 text-primary border border-primary/20 shadow-inner">
              <Tv className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <CardTitle className="text-base font-black uppercase tracking-tight text-foreground flex items-center gap-2">
                {title}
                {(videoSrc || audioSrc) && (
                  <Badge variant="outline" className="text-[10px] font-mono border-rose-500/30 text-rose-400 uppercase bg-rose-500/5">
                    ● Live Link
                  </Badge>
                )}
              </CardTitle>
              {subtitle && (
                <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
              )}
            </div>
          </div>

          {channelFrequency && (
            <div className="flex items-center gap-3">
              <div className="hidden sm:flex items-center gap-1.5 px-3 py-1 rounded-lg bg-background/50 border border-border/60 text-[10px] font-mono text-muted-foreground">
                <Signal className="w-3 h-3 text-emerald-400" />
                <span>{channelFrequency}</span>
              </div>
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="p-6">
        <Tabs value={selectedTab} onValueChange={setSelectedTab} className="w-full space-y-4">
          <div className="flex items-center justify-between">
            <TabsList className="bg-muted/40 border border-border/50 p-1">
              <TabsTrigger value="video" className="gap-2 text-xs font-bold data-[state=active]:bg-primary/20 data-[state=active]:text-primary">
                <Video className="w-3.5 h-3.5" />
                Surveillance Video Feed
              </TabsTrigger>
              <TabsTrigger value="audio" className="gap-2 text-xs font-bold data-[state=active]:bg-primary/20 data-[state=active]:text-primary">
                <Radio className="w-3.5 h-3.5" />
                Tactical Radio Stream
              </TabsTrigger>
            </TabsList>

            <span className="text-[11px] font-mono text-muted-foreground hidden md:inline-block">
              Player Primitive: {selectedTab === "video" ? "<VideoPlayer />" : "<AudioPlayer />"}
            </span>
          </div>

          <TabsContent value="video" className="mt-0 focus-visible:outline-none">
            {videoSrc ? (
              <div className="rounded-2xl overflow-hidden border border-border/60 shadow-lg bg-black/40">
                <VideoPlayer src={videoSrc} title={videoTitle} className="w-full" />
              </div>
            ) : (
              <NoSource kind="video" />
            )}
          </TabsContent>

          <TabsContent value="audio" className="mt-0 focus-visible:outline-none">
            {audioSrc ? (
              <div className="p-8 rounded-2xl border border-border/60 bg-muted/10 flex flex-col items-center justify-center space-y-6">
                <div className="w-16 h-16 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shadow-[0_0_30px_hsl(var(--primary)/0.3)]">
                  <Radio className="w-8 h-8" />
                </div>
                <div className="text-center space-y-1">
                  <h4 className="text-sm font-bold text-foreground">{audioTitle}</h4>
                  {channelFrequency && (
                    <p className="text-xs font-mono text-muted-foreground">{channelFrequency}</p>
                  )}
                </div>
                <div className="w-full max-w-md">
                  <AudioPlayer src={audioSrc} title={audioTitle} className="w-full" />
                </div>
              </div>
            ) : (
              <NoSource kind="audio" />
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

export default PlatformMediaPlayerBlock;
