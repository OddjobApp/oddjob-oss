import React, { useMemo, useCallback } from 'react';
import ReactFlow, { 
  Background, 
  Controls, 
  MiniMap, 
  Node, 
  Edge,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
  MarkerType
} from 'reactflow';
import 'reactflow/dist/style.css';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { Folder, FileText } from 'lucide-react';

const topicQueryKey = ['/api/knowledge/topics'] as const;
const documentQueryKey = ['/api/knowledge/documents'] as const;

// Custom Node for Topics
const TopicNode = ({ data }: { data: any }) => {
  return (
    <div className="px-4 py-2 shadow-md rounded-md bg-card border-2 border-indigo-500 w-[200px]">
      <Handle type="target" position={Position.Top} className="w-16 !bg-indigo-500" />
      <div className="flex items-center gap-2 mb-2">
        <Folder className="w-4 h-4 text-indigo-500" />
        <div className="font-bold text-sm truncate">{data.name}</div>
      </div>
      <div className="text-xs text-muted-foreground truncate">{data.description || 'Topic'}</div>
      {data.documentCount !== undefined && (
        <div className="mt-2 text-xs font-semibold text-indigo-700 bg-indigo-50 rounded-full px-2 py-1 inline-block">
          {data.documentCount} Docs
        </div>
      )}
      <Handle type="source" position={Position.Bottom} className="w-16 !bg-indigo-500" />
    </div>
  );
};

// Custom Node for Documents
const DocumentNode = ({ data }: { data: any }) => {
  return (
    <div className="px-3 py-2 shadow-sm rounded-md bg-card border border-border w-[180px]">
      <Handle type="target" position={Position.Top} className="w-8 !bg-muted" />
      <div className="flex items-center gap-2 mb-1">
        <FileText className="w-3 h-3 text-muted-foreground" />
        <div className="font-medium text-xs truncate">{data.title}</div>
      </div>
      <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{data.sourceType || 'DOCUMENT'}</div>
      <Handle type="source" position={Position.Bottom} className="w-8 !bg-muted" />
    </div>
  );
};

const nodeTypes = {
  topic: TopicNode,
  document: DocumentNode,
};

export const KnowledgeTopicGraph = () => {
  const { data: topicsData, isLoading: topicsLoading } = useQuery({
    queryKey: topicQueryKey,
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/knowledge/topics');
      return res.json();
    },
  });

  const { data: documentsData, isLoading: documentsLoading } = useQuery({
    queryKey: documentQueryKey,
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/knowledge/documents');
      return res.json();
    },
  });

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  // Transform data into ReactFlow nodes and edges
  React.useEffect(() => {
    if (topicsLoading || documentsLoading || !topicsData?.topics || !documentsData?.documents) {
      return;
    }

    const newNodes: Node[] = [];
    const newEdges: Edge[] = [];

    const topics = topicsData.topics;
    const documents = documentsData.documents;

    // We need a simple auto-layout logic for presentation.
    // For a real production app we might use dagre or elkjs for graph layout,
    // but here we can do a naive grid/tree layout based on parentId.
    
    // Map topics
    const topicLevels: Record<number, number> = {};
    const getLevel = (topicId: number, visited = new Set<number>()): number => {
      if (visited.has(topicId)) return 0; // prevent cycles
      visited.add(topicId);
      
      const topic = topics.find((t: any) => t.id === topicId);
      if (!topic || !topic.parentTopicId) return 0;
      return 1 + getLevel(topic.parentTopicId, visited);
    };

    topics.forEach((topic: any) => {
      topicLevels[topic.id] = getLevel(topic.id);
    });

    // Group topics by level
    const topicsByLevel: Record<number, any[]> = {};
    topics.forEach((topic: any) => {
      const lvl = topicLevels[topic.id];
      if (!topicsByLevel[lvl]) topicsByLevel[lvl] = [];
      topicsByLevel[lvl].push(topic);
    });

    let yOffset = 50;
    
    // Position Topics
    Object.keys(topicsByLevel).sort((a, b) => Number(a) - Number(b)).forEach((levelStr) => {
      const lvl = Number(levelStr);
      const levelTopics = topicsByLevel[lvl];
      
      const startX = -(levelTopics.length * 250) / 2;
      
      levelTopics.forEach((topic: any, idx: number) => {
        newNodes.push({
          id: `topic-${topic.id}`,
          type: 'topic',
          position: { x: startX + (idx * 250), y: yOffset },
          data: { 
            name: topic.name, 
            description: topic.description,
            documentCount: topic.documentCount 
          },
        });

        if (topic.parentTopicId) {
          newEdges.push({
            id: `edge-t${topic.parentTopicId}-t${topic.id}`,
            source: `topic-${topic.parentTopicId}`,
            target: `topic-${topic.id}`,
            type: 'smoothstep',
            animated: true,
            style: { stroke: '#6366f1', strokeWidth: 2 },
            markerEnd: {
              type: MarkerType.ArrowClosed,
              color: '#6366f1',
            },
          });
        }
      });
      
      yOffset += 200;
    });

    // Position Documents
    const documentsWithoutTopics = [];
    const topicDocsMap: Record<number, any[]> = {};

    documents.forEach((doc: any) => {
      if (!doc.topics || doc.topics.length === 0) {
        documentsWithoutTopics.push(doc);
      } else {
        doc.topics.forEach((t: any) => {
          if (!topicDocsMap[t.id]) topicDocsMap[t.id] = [];
          topicDocsMap[t.id].push(doc);
        });
      }
    });

    // We will place documents below their respective topics
    // To avoid overlap, we'll place them in rows
    topics.forEach((topic: any) => {
      const docs = topicDocsMap[topic.id] || [];
      const topicNode = newNodes.find(n => n.id === `topic-${topic.id}`);
      if (!topicNode) return;
      
      const baseX = topicNode.position.x;
      const baseY = topicNode.position.y + 120;
      
      const rowSize = 3;
      docs.forEach((doc: any, idx: number) => {
        const row = Math.floor(idx / rowSize);
        const col = idx % rowSize;
        
        const docNodeId = `doc-${doc.id}-t${topic.id}`; // compound id in case doc is in multiple topics
        
        newNodes.push({
          id: docNodeId,
          type: 'document',
          position: { 
            x: baseX + ((col - (Math.min(docs.length, rowSize) - 1) / 2) * 200), 
            y: baseY + (row * 100) 
          },
          data: { title: doc.title, sourceType: doc.sourceType },
        });

        newEdges.push({
          id: `edge-t${topic.id}-${docNodeId}`,
          source: `topic-${topic.id}`,
          target: docNodeId,
          type: 'default',
          style: { stroke: '#94a3b8' },
        });
      });
    });

    setNodes(newNodes);
    setEdges(newEdges);
  }, [topicsData, documentsData, setNodes, setEdges, topicsLoading, documentsLoading]);

  if (topicsLoading || documentsLoading) {
    return (
      <div className="flex items-center justify-center h-full w-full min-h-[500px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  return (
    <div className="h-full w-full min-h-[600px] border rounded-md bg-muted relative overflow-hidden">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        attributionPosition="bottom-right"
      >
        <Background color="#ccc" gap={16} />
        <Controls />
        <MiniMap zoomable pannable nodeClassName={(n) => {
          if (n.type === 'topic') return 'bg-indigo-500';
          return 'bg-muted';
        }} />
      </ReactFlow>
    </div>
  );
};

export default KnowledgeTopicGraph;
