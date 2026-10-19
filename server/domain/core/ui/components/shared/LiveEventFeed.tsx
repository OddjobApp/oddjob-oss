import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Wifi, WifiOff, Trash2, Filter, Activity, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card.js';
import { Button } from '../ui/button.js';
import { Badge } from '../ui/badge.js';
import { ScrollArea } from '../ui/scroll-area.js';
import { useEventStream } from '../../hooks/useEventStream.js';

interface LiveEventFeedProps {
  title?: string;
  filter?: string | string[];
  maxHeight?: string;
  showControls?: boolean;
  className?: string;
}

const getEventColor = (eventType: string): string => {
  if (eventType.startsWith("forge.")) return "bg-purple-500/20 text-purple-700 dark:text-purple-300 border-purple-500/30";
  if (eventType.startsWith("mission.")) return "bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 border-indigo-500/30";
  if (eventType.startsWith("pipeline.")) return "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-500/30";
  if (eventType.startsWith("job.")) return "bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-500/30";
  if (eventType.startsWith("agent.")) return "bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 border-cyan-500/30";
  if (eventType.startsWith("error")) return "bg-rose-500/20 text-rose-700 dark:text-rose-300 border-rose-500/30";
  return "bg-foreground/10 text-foreground/60 border-foreground/20";
};

const formatTimestamp = (timestamp: number): string => {
  const date = new Date(timestamp);
  return date.toLocaleTimeString() + "." + String(date.getMilliseconds()).padStart(3, "0");
};

export default function LiveEventFeed({
  title = "Live Event Feed",
  filter,
  maxHeight = "400px",
  showControls = true,
  className = "",
}: LiveEventFeedProps) {
  const { events, isConnected, lastEvent, clear, reconnect } = useEventStream({
    type: filter,
    autoConnect: true,
  });

  const [selectedEvent, setSelectedEvent] = useState<string | null>(null);

  return (
    <Card className={`bg-background/40 border-foreground/10 backdrop-blur-xl ${className}`}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <div className="flex items-center gap-3">
          <Activity className="h-5 w-5 text-indigo-400" />
          <CardTitle className="text-lg font-bold text-foreground">{title}</CardTitle>
          <Badge 
            variant="outline" 
            className={isConnected 
              ? "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-500/30" 
              : "bg-rose-500/20 text-rose-700 dark:text-rose-300 border-rose-500/30"
            }
          >
            {isConnected ? (
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                LIVE
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <WifiOff className="h-3 w-3" />
                OFFLINE
              </span>
            )}
          </Badge>
        </div>
        
        {showControls && (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={clear}
              className="h-8 w-8 text-foreground/30 hover:text-foreground"
              title="Clear events"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={reconnect}
              className="h-8 w-8 text-foreground/30 hover:text-foreground"
              title="Reconnect"
            >
              <Wifi className="h-4 w-4" />
            </Button>
          </div>
        )}
      </CardHeader>

      <CardContent>
        {/* Stats */}
        <div className="flex items-center gap-4 mb-3 text-xs text-foreground/40">
          <span>{events.length} events</span>
          {lastEvent && (
            <span>Last: {formatTimestamp(lastEvent.timestamp)}</span>
          )}
          {filter && (
            <span className="flex items-center gap-1">
              <Filter className="h-3 w-3" />
              {Array.isArray(filter) ? filter.join(", ") : filter}
            </span>
          )}
        </div>

        {/* Event List */}
        <ScrollArea className="pr-4" style={{ height: maxHeight }}>
          <div className="space-y-1">
            <AnimatePresence initial={false}>
              {events.length === 0 ? (
                <div className="text-center py-12 text-foreground/20">
                  <Wifi className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">Waiting for events...</p>
                  {!isConnected && (
                    <p className="text-xs mt-1">Connection lost. Reconnecting...</p>
                  )}
                </div>
              ) : (
                events.slice().reverse().map((event, index) => (
                  <motion.div
                    key={event.eventId}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2, delay: index < 5 ? index * 0.03 : 0 }}
                    onClick={() => setSelectedEvent(
                      selectedEvent === event.eventId ? null : event.eventId
                    )}
                    className={`p-2 rounded cursor-pointer transition-colors ${
                      selectedEvent === event.eventId 
                        ? "bg-foreground/10" 
                        : "hover:bg-foreground/5"
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <Badge 
                        variant="outline" 
                        className={`text-xs shrink-0 ${getEventColor(event.eventType)}`}
                      >
                        {event.eventType.split(".").pop() || event.eventType}
                      </Badge>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-foreground/70 truncate">
                            {event.eventType}
                          </span>
                          <span className="text-xs text-foreground/30 shrink-0">
                            {formatTimestamp(event.timestamp)}
                          </span>
                        </div>
                        
                        <AnimatePresence>
                          {selectedEvent === event.eventId && (
                            <motion.div
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: "auto" }}
                              exit={{ opacity: 0, height: 0 }}
                              className="mt-2 p-2 rounded bg-background/40"
                            >
                              <div className="flex justify-between text-xs text-foreground/40 mb-1">
                                <span>Source: {event.source}</span>
                                <span>ID: {event.eventId.slice(-8)}</span>
                              </div>
                              <pre className="text-xs text-foreground/60 font-mono overflow-x-auto max-h-32">
                                {JSON.stringify(event.payload, null, 2)}
                              </pre>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </div>
                  </motion.div>
                ))
              )}
            </AnimatePresence>
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
