import React from 'react';
import { motion } from 'framer-motion';
import { Search, Filter, MoreHorizontal, Play, Square, RefreshCcw, ExternalLink } from 'lucide-react';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '../ui/table.js';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card.js';
import { Badge } from '../ui/badge.js';
import { Button } from '../ui/button.js';
import { Input } from '../ui/input.js';
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger 
} from '../ui/dropdown-menu.js';

interface Mission {
  id: string;
  name: string;
  status: 'active' | 'completed' | 'failed' | 'pending';
  objective: string;
  startedAt: string;
}

interface MissionControlTableProps {
  missions?: Mission[];
  onTrigger?: (id: string) => void;
  onAbort?: (id: string) => void;
}

const defaultMissions: Mission[] = [
  { id: 'm-1', name: 'Neural Link Stabilizer', status: 'active', objective: 'Balance synaptic flux', startedAt: '2024-04-26 10:00' },
  { id: 'm-2', name: 'Grid Breach Repair', status: 'completed', objective: 'Patch layer-7 anomalies', startedAt: '2024-04-26 09:15' },
  { id: 'm-3', name: 'Deep Space Sync', status: 'failed', objective: 'Establish quantum link', startedAt: '2024-04-26 08:30' },
  { id: 'm-4', name: 'Ghost Protocol', status: 'pending', objective: 'Stealth diagnostic sweep', startedAt: '2024-04-26 11:20' },
];

export default function MissionControlTable({
  missions = defaultMissions,
  onTrigger,
  onAbort
}: MissionControlTableProps) {
  return (
    <Card className="bg-background/40 border-foreground/10 backdrop-blur-xl">
      <CardHeader className="flex flex-col gap-3 space-y-0 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle className="text-xl font-bold text-foreground flex items-center gap-2">
          <Play className="w-5 h-5 text-indigo-400 fill-indigo-400" />
          Mission Control
        </CardTitle>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <div className="relative flex-1 sm:flex-none">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input 
              placeholder="Search missions..." 
              className="pl-9 w-full sm:w-[200px] lg:w-[300px] bg-foreground/5 border-foreground/10 focus:ring-indigo-500"
            />
          </div>
          <Button variant="outline" size="icon" className="bg-foreground/5 border-foreground/10">
            <Filter className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3 md:hidden">
          {missions.map((mission, i) => (
            <motion.div
              key={mission.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, delay: i * 0.04 }}
              className="rounded-lg border border-foreground/10 bg-foreground/[0.03] p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium text-foreground">{mission.name}</p>
                  <p className="mt-1 font-mono text-xs text-muted-foreground">{mission.id}</p>
                </div>
                <Badge
                  variant="outline"
                  className={
                    mission.status === 'active' ? "bg-indigo-500/10 text-indigo-400 border-indigo-500/20" :
                    mission.status === 'completed' ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" :
                    mission.status === 'failed' ? "bg-rose-500/10 text-rose-400 border-rose-500/20" :
                    "bg-foreground/5 text-muted-foreground border-foreground/10"
                  }
                >
                  {mission.status.toUpperCase()}
                </Badge>
              </div>
              <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">{mission.objective}</p>
              <div className="mt-3 flex items-center justify-between gap-3">
                <span className="text-xs text-muted-foreground">{mission.startedAt}</span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="bg-card border-foreground/10 text-foreground">
                    <DropdownMenuItem onClick={() => onTrigger?.(mission.id)} className="gap-2">
                      <Play className="w-4 h-4" /> Run Mission
                    </DropdownMenuItem>
                    <DropdownMenuItem className="gap-2">
                      <RefreshCcw className="w-4 h-4" /> Relaunch
                    </DropdownMenuItem>
                    <DropdownMenuItem className="gap-2">
                      <ExternalLink className="w-4 h-4" /> View Details
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onAbort?.(mission.id)} className="gap-2 text-rose-400 focus:text-rose-400">
                      <Square className="w-4 h-4" /> Abort
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </motion.div>
          ))}
        </div>
        <Table className="hidden md:table">
          <TableHeader className="bg-foreground/5">
            <TableRow className="border-foreground/5 hover:bg-transparent">
              <TableHead className="text-foreground/70">Mission ID</TableHead>
              <TableHead className="text-foreground/70">Name</TableHead>
              <TableHead className="text-foreground/70">Status</TableHead>
              <TableHead className="text-foreground/70">Objective</TableHead>
              <TableHead className="text-foreground/70">Timestamp</TableHead>
              <TableHead className="text-right text-foreground/70">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {missions.map((mission, i) => (
              <motion.tr
                key={mission.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3, delay: i * 0.05 }}
                className="border-foreground/5 hover:bg-foreground/5 transition-colors group"
              >
                <TableCell className="font-mono text-xs text-muted-foreground">{mission.id}</TableCell>
                <TableCell className="font-medium text-foreground">{mission.name}</TableCell>
                <TableCell>
                  <Badge 
                    variant="outline" 
                    className={
                      mission.status === 'active' ? "bg-indigo-500/10 text-indigo-400 border-indigo-500/20" :
                      mission.status === 'completed' ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" :
                      mission.status === 'failed' ? "bg-rose-500/10 text-rose-400 border-rose-500/20" :
                      "bg-foreground/5 text-muted-foreground border-foreground/10"
                    }
                  >
                    {mission.status.toUpperCase()}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground text-sm max-w-[200px] truncate">
                  {mission.objective}
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">{mission.startedAt}</TableCell>
                <TableCell className="text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="bg-card border-foreground/10 text-foreground">
                      <DropdownMenuItem onClick={() => onTrigger?.(mission.id)} className="gap-2">
                        <Play className="w-4 h-4" /> Run Mission
                      </DropdownMenuItem>
                      <DropdownMenuItem className="gap-2">
                        <RefreshCcw className="w-4 h-4" /> Relaunch
                      </DropdownMenuItem>
                      <DropdownMenuItem className="gap-2">
                        <ExternalLink className="w-4 h-4" /> View Details
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onAbort?.(mission.id)} className="gap-2 text-rose-400 focus:text-rose-400">
                        <Square className="w-4 h-4" /> Abort
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </motion.tr>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
