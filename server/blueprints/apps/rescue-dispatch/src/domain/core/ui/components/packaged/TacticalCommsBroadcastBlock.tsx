import React, { useState } from "react";
import { Radio, Volume2, VolumeX, Send, AlertTriangle, Shield, Check } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "../ui/card.js";
import { Button } from "../ui/button.js";
import { Badge } from "../ui/badge.js";

interface TacticalCommsBroadcastBlockProps {
  channelName?: string;
  frequency?: string;
  onBroadcast?: (message: string) => void;
}

export default function TacticalCommsBroadcastBlock({
  channelName = "Emergency Ops Channel 1",
  frequency = "148.825 MHz // ENCRYPTED",
  onBroadcast
}: TacticalCommsBroadcastBlockProps) {
  const [muted, setMuted] = useState(false);
  const [broadcastMessage, setBroadcastMessage] = useState("");
  const [lastSent, setLastSent] = useState<string | null>(null);

  const handleSend = () => {
    if (!broadcastMessage.trim()) return;
    onBroadcast?.(broadcastMessage);
    setLastSent(broadcastMessage);
    setBroadcastMessage("");
    setTimeout(() => setLastSent(null), 4000);
  };

  return (
    <Card className="border border-rose-500/20 bg-[#150d12] text-[#f2f7f5] rounded-2xl overflow-hidden shadow-2xl">
      <CardHeader className="border-b border-rose-500/20 px-5 py-4 flex flex-row items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-rose-500/20 border border-rose-500/30 text-rose-400">
            <Radio className="h-5 w-5 animate-pulse" />
          </div>
          <div>
            <CardTitle className="text-base font-bold text-rose-200 tracking-tight">{channelName}</CardTitle>
            <p className="text-xs text-rose-300/70 font-mono">{frequency}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Badge className="bg-rose-500/20 text-rose-300 border-rose-500/40 text-xs px-2.5 py-0.5 font-mono">
            ● LIVE NET
          </Badge>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setMuted(!muted)}
            className="h-8 w-8 text-rose-300 hover:text-white hover:bg-rose-500/20"
          >
            {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="p-5 flex flex-col gap-3">
        <p className="text-xs text-rose-200/80 font-mono leading-relaxed">
          Broadcast emergency operational instructions directly to all units in field and registered providers.
        </p>

        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Type priority dispatch transmission..."
            value={broadcastMessage}
            onChange={(e) => setBroadcastMessage(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            className="flex-1 px-3 py-2 bg-black/50 border border-rose-500/30 rounded-xl text-xs text-white placeholder:text-rose-400/40 focus:outline-none focus:border-rose-400 font-mono"
          />
          <Button
            onClick={handleSend}
            disabled={!broadcastMessage.trim()}
            className="bg-rose-600 hover:bg-rose-500 text-white text-xs px-4 rounded-xl font-bold font-mono"
          >
            <Send className="h-3.5 w-3.5 mr-1" />
            BROADCAST
          </Button>
        </div>

        {lastSent && (
          <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center gap-2 text-xs font-mono text-rose-300">
            <Check className="h-3.5 w-3.5 text-emerald-400" />
            <span>Transmitted: "{lastSent}"</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
