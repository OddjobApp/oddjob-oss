"use client";

import React, { useState, useCallback, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  MessageSquare,
  BarChart3,
  Table2,
  LineChart,
  PieChart,
  Sparkles,
  Send,
  Clock,
  Database,
  Brain,
  ChevronRight,
  Lightbulb,
  TrendingUp,
  AlertCircle,
  CheckCircle,
  XCircle,
  Download,
  MoreHorizontal,
  History,
  Bookmark,
  Share2,
  Wand2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Input } from "../ui/input";
import { Skeleton } from "../ui/skeleton";
import { ScrollArea } from "../ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import {
  LineChart as ReLineChart,
  Line,
  BarChart as ReBarChart,
  Bar,
  PieChart as RePieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Area,
  AreaChart,
} from "recharts";

interface NLQMessage {
  id: string;
  type: "user" | "ai";
  content: string;
  timestamp: Date;
  queryResult?: QueryResult;
  followUpSuggestions?: string[];
  confidence?: number;
  explanation?: string;
  sql?: string;
  executionTime?: number;
}

interface QueryResult {
  type: "table" | "chart" | "scalar" | "error";
  data: any[] | number | string;
  chartType?: "line" | "bar" | "pie" | "area";
  columns?: string[];
  title?: string;
  description?: string;
}

interface PlatformNLQBlockProps {
  collection: string;
  contextDescription?: string;
  title?: string;
  placeholder?: string;
  generateCharts?: boolean;
  explainInsights?: boolean;
  suggestFollowUps?: boolean;
  maxHistory?: number;
  enableExport?: boolean;
  exampleQuestions?: string[];
  onQuery?: (question: string, result: QueryResult) => void;
}

const COLORS = ["#8b5cf6", "#ec4899", "#3b82f6", "#10b981", "#f59e0b", "#ef4444"];

export default function PlatformNLQBlock({
  collection,
  contextDescription = `Data from ${collection}`,
  title = "Ask Your Data",
  placeholder = "Ask a question about your data...",
  generateCharts = true,
  explainInsights = true,
  suggestFollowUps = true,
  maxHistory = 50,
  enableExport = true,
  exampleQuestions = [
    "What were total sales last month?",
    "Show me the top 5 customers by revenue",
    "Compare this quarter vs last quarter",
    "What trends do you see over time?",
    "Which products have declining sales?",
  ],
  onQuery,
}: PlatformNLQBlockProps) {
  const [messages, setMessages] = useState<NLQMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [savedQueries, setSavedQueries] = useState<string[]>([]);
  const [showExamples, setShowExamples] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const generateMockResult = (question: string): QueryResult => {
    const lowerQ = question.toLowerCase();

    // Detect intent from question
    const isComparison = lowerQ.includes("compare") || lowerQ.includes("vs") || lowerQ.includes("versus");
    const isTrend = lowerQ.includes("trend") || lowerQ.includes("over time") || lowerQ.includes("history");
    const isTopN = lowerQ.includes("top") || lowerQ.includes("best") || lowerQ.includes("highest");
    const isTotal = lowerQ.includes("total") || lowerQ.includes("sum") || lowerQ.includes("how much");
    const isBreakdown = lowerQ.includes("breakdown") || lowerQ.includes("by") || lowerQ.includes("per");

    if (isTrend) {
      // Generate time series data
      const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"];
      return {
        type: "chart",
        chartType: "area",
        data: months.map((month) => ({
          month,
          value: Math.floor(50000 + Math.random() * 50000),
          previous: Math.floor(45000 + Math.random() * 40000),
        })),
        title: "Revenue Trend Analysis",
        description: "Revenue shows an upward trend with 23% growth over the period.",
      };
    }

    if (isComparison) {
      return {
        type: "chart",
        chartType: "bar",
        data: [
          { category: "This Quarter", current: 245000, previous: 198000 },
          { category: "Last Quarter", current: 0, previous: 210000 },
        ],
        title: "Quarter-over-Quarter Comparison",
        description: "This quarter is 24% higher than last quarter.",
      };
    }

    if (isTopN) {
      const topCount = parseInt(question.match(/\d+/)?.[0] || "5");
      return {
        type: "chart",
        chartType: "bar",
        data: Array.from({ length: topCount }, (_, i) => ({
          name: `Customer ${String.fromCharCode(65 + i)}`,
          revenue: Math.floor(50000 - i * 8000 + Math.random() * 5000),
        })),
        title: `Top ${topCount} Customers by Revenue`,
        description: "These customers represent 45% of total revenue.",
      };
    }

    if (isTotal) {
      const total = Math.floor(1250000 + Math.random() * 500000);
      return {
        type: "scalar",
        data: total,
        title: "Total Sales",
        description: `Total sales amount to $${total.toLocaleString()}. This is 15% higher than the previous period.`,
      };
    }

    if (isBreakdown) {
      return {
        type: "chart",
        chartType: "pie",
        data: [
          { name: "Product A", value: 35 },
          { name: "Product B", value: 25 },
          { name: "Product C", value: 20 },
          { name: "Product D", value: 15 },
          { name: "Other", value: 5 },
        ],
        title: "Sales Breakdown by Product",
        description: "Product A leads with 35% of total sales.",
      };
    }

    // Default: table view
    return {
      type: "table",
      data: Array.from({ length: 5 }, (_, i) => ({
        id: i + 1,
        date: new Date(Date.now() - i * 86400000).toLocaleDateString(),
        customer: `Customer ${String.fromCharCode(65 + i)}`,
        amount: Math.floor(1000 + Math.random() * 9000),
        status: ["completed", "pending", "processing"][Math.floor(Math.random() * 3)],
      })),
      columns: ["id", "date", "customer", "amount", "status"],
      title: "Recent Transactions",
      description: "Showing the most recent 5 transactions from your dataset.",
    };
  };

  const generateExplanation = (question: string, result: QueryResult): string => {
    const explanations: Record<string, string> = {
      table: `I analyzed your "${collection}" dataset and found ${Array.isArray(result.data) ? result.data.length : 0} records matching your criteria. The results show recent activity across multiple dimensions.`,
      chart: `Based on your question, I visualized the data as a ${result.chartType} chart. ${result.description || ""}`,
      scalar: `I calculated the answer from ${result.title?.toLowerCase() || "your data"}. ${result.description || ""}`,
    };
    return explanations[result.type] || "Here's what I found in your data:";
  };

  const generateFollowUps = (question: string, result: QueryResult): string[] => {
    const followUps: Record<string, string[]> = {
      table: [
        "Can you break this down by category?",
        "Show me trends over time",
        "What's the total amount?",
        "Compare this to last month",
      ],
      chart: [
        "What caused these changes?",
        "Show me the underlying data",
        "Compare with previous period",
        "Break this down by segment",
      ],
      scalar: [
        "How does this compare to last month?",
        "What's the breakdown by category?",
        "Show me the trend over time",
        "Which items contribute most?",
      ],
    };
    return followUps[result.type] || ["Tell me more", "Show breakdown", "Compare periods", "Export results"];
  };

  const handleSend = async () => {
    if (!inputValue.trim() || isProcessing) return;

    const question = inputValue.trim();
    setInputValue("");
    setShowExamples(false);
    setIsProcessing(true);

    // Add user message
    const userMessage: NLQMessage = {
      id: `user-${Date.now()}`,
      type: "user",
      content: question,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev.slice(-maxHistory + 1), userMessage]);

    // Simulate AI processing
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // Generate result
    const startTime = Date.now();
    const result = generateMockResult(question);
    const executionTime = Date.now() - startTime;

    const aiMessage: NLQMessage = {
      id: `ai-${Date.now()}`,
      type: "ai",
      content: generateExplanation(question, result),
      timestamp: new Date(),
      queryResult: generateCharts && result.type !== "scalar" ? result : undefined,
      confidence: 0.85 + Math.random() * 0.1,
      explanation: explainInsights ? generateExplanation(question, result) : undefined,
      sql: `SELECT * FROM ${collection} WHERE ...`,
      executionTime,
      followUpSuggestions: suggestFollowUps ? generateFollowUps(question, result) : undefined,
    };

    setMessages((prev) => [...prev, aiMessage]);
    setIsProcessing(false);

    if (onQuery) {
      onQuery(question, result);
    }
  };

  const handleExampleClick = (question: string) => {
    setInputValue(question);
    inputRef.current?.focus();
  };

  const saveQuery = (question: string) => {
    if (!savedQueries.includes(question)) {
      setSavedQueries((prev) => [...prev, question]);
    }
  };

  const exportResult = (result: QueryResult) => {
    const dataStr = JSON.stringify(result.data, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `query-result-${new Date().toISOString().split("T")[0]}.json`;
    a.click();
  };

  const renderChart = (result: QueryResult) => {
    if (!result.chartType || !Array.isArray(result.data)) return null;

    const chartHeight = 250;

    switch (result.chartType) {
      case "line":
        return (
          <ResponsiveContainer width="100%" height={chartHeight}>
            <ReLineChart data={result.data}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
              <XAxis dataKey={Object.keys(result.data[0] || {})[0]} stroke="rgba(255,255,255,0.5)" />
              <YAxis stroke="rgba(255,255,255,0.5)" />
              <Tooltip
                contentStyle={{ backgroundColor: "rgba(0,0,0,0.8)", border: "1px solid rgba(255,255,255,0.1)" }}
                labelStyle={{ color: "rgba(255,255,255,0.8)" }}
              />
              <Legend />
              <Line
                type="monotone"
                dataKey={Object.keys(result.data[0] || {})[1]}
                stroke={COLORS[0]}
                strokeWidth={2}
                dot={{ fill: COLORS[0] }}
              />
            </ReLineChart>
          </ResponsiveContainer>
        );

      case "area":
        return (
          <ResponsiveContainer width="100%" height={chartHeight}>
            <AreaChart data={result.data}>
              <defs>
                <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={COLORS[0]} stopOpacity={0.8} />
                  <stop offset="95%" stopColor={COLORS[0]} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
              <XAxis dataKey="month" stroke="rgba(255,255,255,0.5)" />
              <YAxis stroke="rgba(255,255,255,0.5)" />
              <Tooltip
                contentStyle={{ backgroundColor: "rgba(0,0,0,0.8)", border: "1px solid rgba(255,255,255,0.1)" }}
              />
              <Legend />
              <Area
                type="monotone"
                dataKey="value"
                stroke={COLORS[0]}
                fillOpacity={1}
                fill="url(#colorValue)"
              />
              <Area
                type="monotone"
                dataKey="previous"
                stroke={COLORS[1]}
                fillOpacity={0.3}
                fill={COLORS[1]}
              />
            </AreaChart>
          </ResponsiveContainer>
        );

      case "bar":
        return (
          <ResponsiveContainer width="100%" height={chartHeight}>
            <ReBarChart data={result.data}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
              <XAxis dataKey={Object.keys(result.data[0] || {})[0]} stroke="rgba(255,255,255,0.5)" />
              <YAxis stroke="rgba(255,255,255,0.5)" />
              <Tooltip
                contentStyle={{ backgroundColor: "rgba(0,0,0,0.8)", border: "1px solid rgba(255,255,255,0.1)" }}
              />
              <Legend />
              {Object.keys(result.data[0] || {})
                .slice(1)
                .map((key, idx) => (
                  <Bar key={key} dataKey={key} fill={COLORS[idx % COLORS.length]} />
                ))}
            </ReBarChart>
          </ResponsiveContainer>
        );

      case "pie":
        return (
          <ResponsiveContainer width="100%" height={chartHeight}>
            <RePieChart>
              <Pie
                data={result.data}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                outerRadius={80}
                fill="#8884d8"
                dataKey="value"
              >
                {(result.data as any[]).map((_, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ backgroundColor: "rgba(0,0,0,0.8)", border: "1px solid rgba(255,255,255,0.1)" }}
              />
            </RePieChart>
          </ResponsiveContainer>
        );

      default:
        return null;
    }
  };

  const renderTable = (result: QueryResult) => {
    if (!Array.isArray(result.data) || result.data.length === 0) return null;

    const columns = result.columns || Object.keys(result.data[0]);

    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10">
              {columns.map((col) => (
                <th key={col} className="text-left py-2 px-3 font-medium text-white/70 capitalize">
                  {col.replace(/_/g, " ")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.data.map((row: any, idx: number) => (
              <tr key={idx} className="border-b border-white/5 hover:bg-white/5">
                {columns.map((col) => (
                  <td key={col} className="py-2 px-3">
                    {col === "status" ? (
                      <Badge
                        variant="outline"
                        className={`text-[10px] ${
                          row[col] === "completed"
                            ? "border-green-500/30 text-green-400"
                            : row[col] === "pending"
                            ? "border-yellow-500/30 text-yellow-400"
                            : "border-blue-500/30 text-blue-400"
                        }`}
                      >
                        {row[col]}
                      </Badge>
                    ) : col === "amount" || col === "revenue" ? (
                      <span className="font-mono">
                        ${typeof row[col] === "number" ? row[col].toLocaleString() : row[col]}
                      </span>
                    ) : (
                      row[col]
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  const renderScalar = (result: QueryResult) => {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-center">
          <p className="text-5xl font-bold bg-gradient-to-r from-violet-400 to-fuchsia-400 bg-clip-text text-transparent">
            {typeof result.data === "number" ? `$${result.data.toLocaleString()}` : result.data}
          </p>
          <p className="text-lg text-white/50 mt-2">{result.title}</p>
        </div>
      </div>
    );
  };

  return (
    <Card className="w-full overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20 border border-violet-500/30">
            <Brain className="w-5 h-5 text-violet-400" />
          </div>
          <div>
            <CardTitle className="flex items-center gap-2">
              {title}
              <Badge variant="secondary" className="text-[10px]">
                <Sparkles className="w-3 h-3 mr-1" />
                AI-Powered
              </Badge>
            </CardTitle>
            <p className="text-xs text-white/50">{contextDescription}</p>
          </div>
        </div>
        {savedQueries.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm">
                <Bookmark className="w-4 h-4 mr-2" />
                Saved ({savedQueries.length})
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {savedQueries.map((query, idx) => (
                <DropdownMenuItem key={idx} onClick={() => setInputValue(query)}>
                  {query}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Chat Area */}
        <ScrollArea ref={scrollRef} className="h-[400px] rounded-lg border border-white/10 bg-black/30 p-4">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center">
              <div className="p-4 rounded-full bg-violet-500/10 mb-4">
                <MessageSquare className="w-8 h-8 text-violet-400" />
              </div>
              <p className="text-white/50 mb-2">Ask me anything about your data</p>
              <p className="text-sm text-white/30">
                I can analyze trends, create charts, and find insights
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((message) => (
                <motion.div
                  key={message.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`flex ${message.type === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[90%] rounded-lg p-3 ${
                      message.type === "user"
                        ? "bg-violet-500/20 border border-violet-500/30 ml-8"
                        : "bg-white/5 border border-white/10 mr-8"
                    }`}
                  >
                    {message.type === "ai" && (
                      <div className="flex items-center gap-2 mb-2">
                        <Avatar className="w-6 h-6">
                          <AvatarFallback className="bg-gradient-to-br from-violet-500 to-fuchsia-500 text-[10px]">
                            AI
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-xs text-white/50">AI Assistant</span>
                        {message.confidence && (
                          <Badge variant="outline" className="text-[10px]">
                            {(message.confidence * 100).toFixed(0)}% confident
                          </Badge>
                        )}
                      </div>
                    )}

                    <p className="text-sm whitespace-pre-wrap">{message.content}</p>

                    {/* Query Result */}
                    {message.queryResult && (
                      <div className="mt-3 rounded-lg border border-white/10 bg-black/30 p-3">
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="font-medium text-sm">{message.queryResult.title}</h4>
                          {enableExport && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2"
                              onClick={() => exportResult(message.queryResult!)}
                            >
                              <Download className="w-3 h-3" />
                            </Button>
                          )}
                        </div>

                        {message.queryResult.type === "table" && renderTable(message.queryResult)}
                        {message.queryResult.type === "chart" && renderChart(message.queryResult)}
                        {message.queryResult.type === "scalar" && renderScalar(message.queryResult)}

                        {message.queryResult.description && (
                          <p className="text-xs text-white/50 mt-3">
                            {message.queryResult.description}
                          </p>
                        )}
                      </div>
                    )}

                    {/* Metadata */}
                    {message.type === "ai" && (
                      <div className="flex items-center gap-3 mt-2 text-xs text-white/30">
                        {message.executionTime && (
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {message.executionTime}ms
                          </span>
                        )}
                        {message.sql && (
                          <span className="font-mono text-[10px] bg-white/5 px-2 py-0.5 rounded">
                            SQL
                          </span>
                        )}
                      </div>
                    )}

                    {/* Follow-up Suggestions */}
                    {message.followUpSuggestions && message.followUpSuggestions.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-3">
                        {message.followUpSuggestions.map((suggestion, idx) => (
                          <Button
                            key={idx}
                            variant="outline"
                            size="sm"
                            className="text-xs h-7"
                            onClick={() => {
                              setInputValue(suggestion);
                              handleSend();
                            }}
                          >
                            <Wand2 className="w-3 h-3 mr-1" />
                            {suggestion}
                          </Button>
                        ))}
                      </div>
                    )}

                    <p className="text-[10px] text-white/30 mt-2">
                      {message.timestamp.toLocaleTimeString()}
                    </p>
                  </div>
                </motion.div>
              ))}

              {isProcessing && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex justify-start"
                >
                  <div className="bg-white/5 border border-white/10 rounded-lg p-3 mr-8">
                    <div className="flex items-center gap-2">
                      <div className="flex gap-1">
                        <span className="w-2 h-2 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                        <span className="w-2 h-2 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                        <span className="w-2 h-2 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: "300ms" }} />
                      </div>
                      <span className="text-sm text-white/50">Analyzing your data...</span>
                    </div>
                  </div>
                </motion.div>
              )}
            </div>
          )}
        </ScrollArea>

        {/* Example Questions */}
        {showExamples && messages.length === 0 && (
          <div className="space-y-2">
            <p className="text-xs text-white/50 flex items-center gap-2">
              <Lightbulb className="w-3 h-3" />
              Try asking:
            </p>
            <div className="flex flex-wrap gap-2">
              {exampleQuestions.map((question, idx) => (
                <Button
                  key={idx}
                  variant="outline"
                  size="sm"
                  className="text-xs h-8"
                  onClick={() => handleExampleClick(question)}
                >
                  {question}
                </Button>
              ))}
            </div>
          </div>
        )}

        {/* Input Area */}
        <div className="flex items-center gap-2">
          <div className="flex-1 relative">
            <Input
              ref={inputRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
              placeholder={placeholder}
              className="pr-10"
              disabled={isProcessing}
            />
            {inputValue && (
              <Button
                variant="ghost"
                size="sm"
                className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
                onClick={() => setInputValue("")}
              >
                <XCircle className="w-4 h-4" />
              </Button>
            )}
          </div>
          <Button
            onClick={handleSend}
            disabled={!inputValue.trim() || isProcessing}
            className="px-4"
          >
            <Send className="w-4 h-4 mr-2" />
            Ask
          </Button>
        </div>

        {/* Data Source Info */}
        <div className="flex items-center justify-between text-xs text-white/30">
          <div className="flex items-center gap-2">
            <Database className="w-3 h-3" />
            <span>Connected to: {collection}</span>
          </div>
          <div className="flex items-center gap-3">
            {generateCharts && <BarChart3 className="w-3 h-3" />}
            {explainInsights && <TrendingUp className="w-3 h-3" />}
            <span>
              {messages.filter((m) => m.type === "user").length} queries
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Helper component for Avatar
function Avatar({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={`rounded-full overflow-hidden ${className}`}>{children}</div>;
}

function AvatarFallback({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`w-full h-full flex items-center justify-center font-semibold ${className}`}
    >
      {children}
    </div>
  );
}
