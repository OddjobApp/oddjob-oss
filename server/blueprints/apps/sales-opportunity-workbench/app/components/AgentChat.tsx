import React, { useState, useEffect, useRef } from 'react';
import { Send, Bot, User, Sparkles, RefreshCw, AlertCircle, Trash2 } from 'lucide-react';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

interface AgentChatProps {
  agentName: string;
  agentRole: string;
  defaultGreeting?: string;
  pipelineContext?: {
    total: number;
    weighted: number;
    committed: number;
    count: number;
  };
}

interface Job {
  id: number;
  name: string;
  type: string;
}

export function AgentChat({
  agentName,
  agentRole,
  defaultGreeting = "Hello! How can I help you today?",
  pipelineContext
}: AgentChatProps) {
  const [jobId, setJobId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchingJob, setFetchingJob] = useState(true);

  const scrollRef = useRef<HTMLDivElement>(null);

  // Fetch the jobId for the active agent name from /api/jobs
  useEffect(() => {
    async function fetchJobId() {
      setFetchingJob(true);
      setError(null);
      try {
        const result = await fetch('/api/jobs');
        if (!result.ok) throw new Error('Failed to fetch jobs');
        const data = await result.json();
        const jobs = data.items || [];
        const matchedJob = jobs.find(
          (j: Job) => j.type === 'ai_agent' && j.name.toLowerCase() === agentName.toLowerCase()
        );

        if (matchedJob) {
          setJobId(matchedJob.id);
        } else {
          console.warn(`No active agent found for name: ${agentName}`);
          setError(`Agent "${agentName}" not found. Make sure the cycle app is installed.`);
        }
      } catch (err: any) {
        console.error('Failed to load agents:', err);
        setError('Connection failed. Could not retrieve agent status.');
      } finally {
        setFetchingJob(false);
      }
    }

    fetchJobId();
  }, [agentName]);

  // Load message history from localStorage
  useEffect(() => {
    const storageKey = `oddjob_sales_chat_history_${agentName.replace(/\s+/g, '_')}`;
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      try {
        setMessages(JSON.parse(saved));
      } catch (e) {
        setMessages([]);
      }
    } else {
      // Set default greeting with pipeline context
      const greetingWithContext = pipelineContext 
        ? `${defaultGreeting}\n\nCurrent Pipeline Snapshot:\n- Total Pipeline: $${(pipelineContext.total / 1000).toFixed(0)}K\n- Weighted Pipeline: $${(pipelineContext.weighted / 1000).toFixed(0)}K\n- Committed Pipeline: $${(pipelineContext.committed / 1000).toFixed(0)}K\n- Open Opportunities: ${pipelineContext.count}`
        : defaultGreeting;
      
      setMessages([
        {
          id: 'greeting',
          role: 'assistant',
          content: greetingWithContext,
          timestamp: new Date().toISOString()
        }
      ]);
    }
  }, [agentName, defaultGreeting, pipelineContext]);

  // Save history to localStorage
  const saveHistory = (newMessages: Message[]) => {
    setMessages(newMessages);
    const storageKey = `oddjob_sales_chat_history_${agentName.replace(/\s+/g, '_')}`;
    localStorage.setItem(storageKey, JSON.stringify(newMessages));
  };

  // Scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || loading || !jobId) return;

    setInput('');
    setError(null);

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: text,
      timestamp: new Date().toISOString()
    };

    const updatedMessages = [...messages, userMsg];
    saveHistory(updatedMessages);
    setLoading(true);

    try {
      // Send chat request to host Oddjob API
      const res = await fetch('/api/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          context: {
            jobId: jobId,
            mode: 'execute',
            pipelineContext: pipelineContext
          }
        })
      });

      if (!res.ok) {
        throw new Error(`Server returned status ${res.status}`);
      }

      const data = await res.json();
      const reply = data.response || data.content || '(No response received)';

      const assistantMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: reply,
        timestamp: new Date().toISOString()
      };

      saveHistory([...updatedMessages, assistantMsg]);
    } catch (err: any) {
      console.error('Chat error:', err);
      setError(err.message || 'Failed to communicate with the agent.');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleClearHistory = () => {
    if (window.confirm('Are you sure you want to clear the conversation history?')) {
      const storageKey = `oddjob_sales_chat_history_${agentName.replace(/\s+/g, '_')}`;
      localStorage.removeItem(storageKey);
      const greetingWithContext = pipelineContext 
        ? `${defaultGreeting}\n\nCurrent Pipeline Snapshot:\n- Total Pipeline: $${(pipelineContext.total / 1000).toFixed(0)}K\n- Weighted Pipeline: $${(pipelineContext.weighted / 1000).toFixed(0)}K\n- Committed Pipeline: $${(pipelineContext.committed / 1000).toFixed(0)}K\n- Open Opportunities: ${pipelineContext.count}`
        : defaultGreeting;
      
      setMessages([
        {
          id: 'greeting',
          role: 'assistant',
          content: greetingWithContext,
          timestamp: new Date().toISOString()
        }
      ]);
    }
  };

  return (
    <div className="flex flex-col bg-slate-900/40 border border-slate-700/50 backdrop-blur-md rounded-xl overflow-hidden shadow-2xl h-[600px] w-full">
      {/* Header */}
      <div className="p-4 border-b border-slate-700/50 flex items-center justify-between bg-slate-900/60">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center shadow-lg shadow-sky-500/20">
            <Bot className="text-white w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-white tracking-tight">{agentName}</h3>
            <span className="text-[10px] uppercase tracking-wider text-slate-400 font-medium">
              {agentRole}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {fetchingJob ? (
            <RefreshCw className="w-3.5 h-3.5 text-blue-400 animate-spin" />
          ) : jobId ? (
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span className="text-[9px] uppercase tracking-wider text-emerald-400 font-bold">Online</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
              <span className="text-[9px] uppercase tracking-wider text-amber-400 font-bold">Offline</span>
            </div>
          )}
          
          <button
            onClick={handleClearHistory}
            title="Clear Chat History"
            className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-slate-800/60 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-950/20" ref={scrollRef}>
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div className={`max-w-[85%] flex gap-2.5 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                msg.role === 'user' ? 'bg-blue-600/10 border border-blue-500/20' : 'bg-slate-800 border border-slate-700'
              }`}>
                {msg.role === 'user' ? (
                  <User className="w-4 h-4 text-blue-400" />
                ) : (
                  <Sparkles className="w-4 h-4 text-indigo-400" />
                )}
              </div>
              <div className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white rounded-tr-none'
                  : 'bg-slate-800/80 border border-slate-700/50 text-slate-100 rounded-tl-none'
              }`}>
                {msg.content}
              </div>
            </div>
          </div>
        ))}

        {/* Loading / Thinking indicator */}
        {loading && (
          <div className="flex justify-start">
            <div className="flex gap-2.5">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-slate-800 border border-slate-700">
                <Sparkles className="w-4 h-4 text-indigo-400 animate-pulse" />
              </div>
              <div className="px-4 py-3 rounded-2xl rounded-tl-none bg-slate-800/50 border border-slate-700/30 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:0ms]" />
                <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:150ms]" />
                <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:300ms]" />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Error display */}
      {error && (
        <div className="mx-4 mb-2 p-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Input bar */}
      <div className="p-4 border-t border-slate-700/50 bg-slate-900/60 shrink-0">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading || !jobId}
            placeholder={jobId ? "Ask about your pipeline, forecasts, or deal risks..." : "Agent not available..."}
            className="flex-1 bg-slate-950/60 border border-slate-700/60 text-white placeholder:text-slate-500 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          />
          <button
            onClick={handleSend}
            title="Send Message"
            disabled={!input.trim() || loading || !jobId}
            className="bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-medium p-2.5 rounded-xl transition-colors flex items-center justify-center shrink-0 shadow-lg shadow-blue-600/20 disabled:shadow-none"
          >
            <Send className="w-4.5 h-4.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
