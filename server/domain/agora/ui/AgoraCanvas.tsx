import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactFlow, { 
    MiniMap, 
    Controls, 
    Background, 
    Node, 
    Edge, 
    useNodesState, 
    useEdgesState,
    addEdge,
    Connection,
    MarkerType,
    ReactFlowInstance,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Loader2, RefreshCcw, Wand2 } from 'lucide-react';

interface AgoraCanvasProps {
  roomId?: string;
  approvalId?: number;
  missionId?: number;
  mission?: any;
  run?: any;
}

function buildMissionGraph(missionId?: number, mission?: any, run?: any): { nodes: Node[]; edges: Edge[] } {
  const mId = missionId || 1;
  const missionNode: Node = {
    id: `mission-${mId}`,
    position: { x: 80, y: 220 },
    data: { label: mission?.name || `Mission ${mId}` },
    style: { border: '1px solid rgb(34 211 238 / .5)', borderRadius: 14, background: 'rgb(8 47 73 / .92)', color: '#ecfeff', padding: 12, width: 220, fontWeight: 700 },
  };

  const rawMembers = Array.isArray(mission?.members) ? mission.members : [];
  const rawTasks = [
    ...(Array.isArray(run?.missionContext?.plan?.tasks) ? run.missionContext.plan.tasks : []),
    ...(Array.isArray(run?.missionContext?.tasks) ? run.missionContext.tasks : []),
    ...(Array.isArray(run?.executionPlan?.tasks) ? run.executionPlan.tasks : []),
  ];
  const seenTasks = new Set<string>();
  const tasks = rawTasks.filter((task: any, index: number) => {
    const key = String(task?.id ?? task?.taskId ?? task?.name ?? task?.title ?? index);
    if (seenTasks.has(key)) return false;
    seenTasks.add(key);
    return true;
  });

  const memberNodes: Node[] = rawMembers.map((member: any, index: number) => ({
    id: `member-${member.id ?? member.entityId ?? index}`,
    position: { x: 390, y: 80 + index * 130 },
    data: { label: member.name ?? member.jobName ?? member.agentName ?? `${member.entityType ?? 'Agent'} ${member.entityId ?? index + 1}` },
    style: { border: '1px solid rgb(168 85 247 / .45)', borderRadius: 12, background: 'rgb(46 16 101 / .88)', color: '#faf5ff', padding: 10, width: 190 },
  }));
  const taskNodes: Node[] = tasks.map((task: any, index: number) => ({
    id: `task-${task.id ?? task.taskId ?? index}`,
    position: { x: memberNodes.length ? 720 : 390, y: 80 + index * 120 },
    data: { label: task.name ?? task.title ?? task.description ?? `Task ${index + 1}` },
    style: { border: '1px solid rgb(59 130 246 / .45)', borderRadius: 12, background: 'rgb(23 37 84 / .9)', color: '#eff6ff', padding: 10, width: 210 },
  }));

  const edgeStyle = { stroke: '#64748b', strokeWidth: 1.5 };
  const memberEdges: Edge[] = memberNodes.map((node) => ({ id: `mission-${node.id}`, source: missionNode.id, target: node.id, markerEnd: { type: MarkerType.ArrowClosed }, style: edgeStyle }));
  const taskEdges: Edge[] = taskNodes.map((node, index) => ({
    id: `work-${node.id}`,
    source: memberNodes[index % Math.max(memberNodes.length, 1)]?.id ?? missionNode.id,
    target: node.id,
    markerEnd: { type: MarkerType.ArrowClosed },
    style: edgeStyle,
  }));
  return { nodes: [missionNode, ...memberNodes, ...taskNodes], edges: [...memberEdges, ...taskEdges] };
}

export function AgoraCanvas({ roomId, approvalId, missionId, mission, run }: AgoraCanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [isConnected, setIsConnected] = useState(false);
  const [hasInitialState, setHasInitialState] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const ws = useRef<WebSocket | null>(null);
  const flow = useRef<ReactFlowInstance | null>(null);
  const effectiveRoom = roomId || (approvalId ? `deliberation-${approvalId}` : `mission-${missionId || 0}`);
  const fallbackGraph = React.useMemo(() => buildMissionGraph(missionId, mission, run), [missionId, mission, run]);

  // Sync changes to other clients
  // Handle saving state periodically or on change
  useEffect(() => {
    if (hasInitialState && isConnected && ws.current?.readyState === WebSocket.OPEN && nodes.length > 0) {
        const timer = setTimeout(() => {
            ws.current?.send(JSON.stringify({
                type: 'UPDATE_OBJECT',
                payload: { nodes, edges }
            }));
        }, 1000); // Debounce saves
        return () => clearTimeout(timer);
    }
  }, [nodes, edges, isConnected, hasInitialState]);

  useEffect(() => {
    // Establish WebSocket connection
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${window.location.host}/api/agora`);
    ws.current = socket;
    setHasInitialState(false);
    setConnectionError(null);

    socket.onopen = () => {
      setIsConnected(true);
      // Join the Agora room
      socket.send(JSON.stringify({ 
        type: 'JOIN', 
        payload: { 
          roomId: effectiveRoom,
          approvalId,
          missionId: missionId || 0 
        } 
      }));
    };

    socket.onclose = () => {
      setIsConnected(false);
    };

    socket.onerror = () => {
      setConnectionError('Live canvas sync is unavailable. Your current layout remains visible.');
    };

    socket.onmessage = (event) => {
      try {
          const message = JSON.parse(event.data);
          switch (message.type) {
            case 'INITIAL_STATE':
              {
                const savedNodes = Array.isArray(message.payload?.nodes) ? message.payload.nodes : [];
                const savedEdges = Array.isArray(message.payload?.edges) ? message.payload.edges : [];
                if (savedNodes.length > 0) {
                  setNodes(savedNodes);
                  setEdges(savedEdges);
                } else {
                  setNodes(fallbackGraph.nodes);
                  setEdges(fallbackGraph.edges);
                }
                setHasInitialState(true);
                requestAnimationFrame(() => flow.current?.fitView({ padding: 0.18, duration: 350 }));
              }
              break;
            case 'UPDATE_OBJECT':
              // Sync from other clients
              if (message.payload.nodes) setNodes(message.payload.nodes);
              if (message.payload.edges) setEdges(message.payload.edges);
              break;
          }
      } catch (err) {
          console.error("Failed to process Agora message", err);
      }
    };

    return () => {
      socket.close();
    };
  }, [missionId, setNodes, setEdges, fallbackGraph]);

  useEffect(() => {
    if (!hasInitialState || nodes.length > 0 || fallbackGraph.nodes.length === 0) return;
    setNodes(fallbackGraph.nodes);
    setEdges(fallbackGraph.edges);
  }, [fallbackGraph, hasInitialState, nodes.length, setEdges, setNodes]);

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  );

  return (
    <div className="relative w-full h-full bg-background rounded-xl border border-foreground/5 overflow-hidden shadow-2xl">
      <ReactFlow 
        nodes={nodes} 
        edges={edges} 
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onInit={(instance) => { flow.current = instance; }}
        fitView
        fitViewOptions={{ padding: 0.18 }}
        minZoom={0.2}
        maxZoom={1.8}
      >
        <MiniMap 
            nodeColor="#3b82f6"
            maskColor="rgba(0, 0, 0, 0.5)"
            className="!bg-card/80 !border-foreground/10"
        />
        <Controls className="!bg-card !border-foreground/10 !fill-white" />
        <Background color="#334155" gap={20} />
      </ReactFlow>
      
      <div className="absolute top-4 right-4 flex items-center gap-2 px-3 py-1.5 rounded-full bg-card/90 backdrop-blur border border-foreground/10">
        <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
        <span className="text-[10px] font-bold uppercase tracking-wider text-foreground/70">
            {isConnected ? 'Sync Active' : 'Offline'}
        </span>
      </div>

      {!hasInitialState && !connectionError && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none bg-background/30 backdrop-blur-[1px]">
          <div className="flex items-center gap-2 rounded-xl border border-foreground/10 bg-card/90 px-4 py-3 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading mission workspace…</div>
        </div>
      )}

      {nodes.length === 0 && hasInitialState && (
        <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center space-y-2">
                <p className="text-foreground text-sm font-semibold">No mission structure is available yet</p>
                <p className="text-muted-foreground text-xs">Start with the mission node and add live work as the run progresses.</p>
                <Button size="sm" className="mt-2" onClick={() => { setNodes(fallbackGraph.nodes); setEdges(fallbackGraph.edges); requestAnimationFrame(() => flow.current?.fitView({ padding: 0.18 })); }}><Wand2 className="mr-2 h-4 w-4" />Build mission canvas</Button>
            </div>
        </div>
      )}

      {connectionError && (
        <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-amber-400/30 bg-card/95 px-4 py-3 text-xs shadow-xl">
          <span className="text-muted-foreground">{connectionError}</span>
          <Button size="sm" variant="outline" onClick={() => window.location.reload()}><RefreshCcw className="mr-2 h-3.5 w-3.5" />Reconnect</Button>
        </div>
      )}
    </div>
  );
}
