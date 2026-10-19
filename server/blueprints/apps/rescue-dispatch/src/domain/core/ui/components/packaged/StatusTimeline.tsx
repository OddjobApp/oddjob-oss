import React from 'react';
import { motion } from 'framer-motion';
import { CheckCircle2, Clock, AlertCircle, Info, Play, Circle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '../ui/badge.js';

interface TimelineEvent {
  id: string;
  timestamp: string;
  title: string;
  description?: string;
  status: 'completed' | 'in_progress' | 'failed' | 'pending' | 'info';
}

interface StatusTimelineProps {
  events: TimelineEvent[];
  title?: string;
  className?: string;
}

const STATUS_CONFIG = {
  completed: {
    icon: CheckCircle2,
    color: 'text-emerald-400',
    bg: 'bg-emerald-400/10',
    border: 'border-emerald-500/20',
  },
  in_progress: {
    icon: Play,
    color: 'text-indigo-400',
    bg: 'bg-indigo-400/10',
    border: 'border-indigo-500/20',
  },
  failed: {
    icon: AlertCircle,
    color: 'text-rose-400',
    bg: 'bg-rose-400/10',
    border: 'border-rose-500/20',
  },
  pending: {
    icon: Clock,
    color: 'text-white/40',
    bg: 'bg-white/5',
    border: 'border-white/10',
  },
  info: {
    icon: Info,
    color: 'text-sky-400',
    bg: 'bg-sky-400/10',
    border: 'border-sky-500/20',
  },
};

export default function StatusTimeline({ 
  events, 
  title = "Mission Sequence",
  className 
}: StatusTimelineProps) {
  return (
    <div className={cn("p-6 bg-white/5 border border-white/5 rounded-3xl backdrop-blur-xl", className)}>
      <div className="flex items-center justify-between mb-8">
        <h3 className="text-lg font-bold flex items-center gap-2">
          <div className="w-2 h-6 bg-indigo-500 rounded-full" />
          {title}
        </h3>
        <Badge variant="outline" className="bg-white/5 border-white/10 text-white/50">
          {events.length} Events
        </Badge>
      </div>

      <div className="space-y-0 relative">
        {/* Vertical line */}
        <div className="absolute left-4 top-2 bottom-2 w-px bg-gradient-to-b from-white/10 via-white/5 to-transparent" />

        {events.map((event, i) => {
          const config = STATUS_CONFIG[event.status] || STATUS_CONFIG.pending;
          const Icon = config.icon;

          return (
            <motion.div
              key={event.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.4, delay: i * 0.05 }}
              className="relative pl-12 pb-8 last:pb-0"
            >
              {/* Dot */}
              <div className={cn(
                "absolute left-0 w-8 h-8 rounded-full flex items-center justify-center border backdrop-blur-md z-10",
                config.bg, config.border, config.color
              )}>
                <Icon size={14} className={event.status === 'in_progress' ? 'animate-pulse' : ''} />
              </div>

              <div className="flex flex-col">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className={cn("font-bold text-sm", config.color)}>{event.title}</span>
                  <span className="text-[10px] text-white/20 font-mono">
                    {new Date(event.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                {event.description && (
                  <p className="text-xs text-white/50 leading-relaxed max-w-lg">
                    {event.description}
                  </p>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
