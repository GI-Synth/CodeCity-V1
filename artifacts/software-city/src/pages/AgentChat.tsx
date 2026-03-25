import { useState, useEffect, useRef, useCallback } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Send, Filter, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ────────────────────────────────────────────────────────────────────

interface AgentMessage {
  id: string;
  timestamp: number;
  fromAgent: string;
  toAgent: string;
  messageType: string;
  content: string;
  findingId?: string | null;
  vote?: string | null;
  metadata: Record<string, unknown>;
}

// ── Agent color/emoji mapping ────────────────────────────────────────────────

const AGENT_STYLES: Record<string, { color: string; bg: string; emoji: string }> = {
  architect:      { color: "text-amber-400",   bg: "bg-amber-400/10",   emoji: "🏗" },
  security:       { color: "text-red-400",     bg: "bg-red-400/10",     emoji: "🛡" },
  performance:    { color: "text-yellow-400",  bg: "bg-yellow-400/10",  emoji: "⚡" },
  quality:        { color: "text-green-400",   bg: "bg-green-400/10",   emoji: "✅" },
  documentation:  { color: "text-cyan-400",    bg: "bg-cyan-400/10",    emoji: "📝" },
  console_log:    { color: "text-gray-400",    bg: "bg-gray-400/10",    emoji: "📟" },
  mayor:          { color: "text-purple-400",  bg: "bg-purple-500/20",  emoji: "👑" },
  qa_inspector:   { color: "text-blue-400",    bg: "bg-blue-400/10",    emoji: "🔍" },
  api_fuzzer:     { color: "text-orange-400",  bg: "bg-orange-400/10",  emoji: "🔥" },
  load_tester:    { color: "text-yellow-300",  bg: "bg-yellow-300/10",  emoji: "⚡" },
  edge_explorer:  { color: "text-green-300",   bg: "bg-green-300/10",   emoji: "🧭" },
  ui_navigator:   { color: "text-violet-400",  bg: "bg-violet-400/10",  emoji: "🖱" },
  scribe:         { color: "text-emerald-400", bg: "bg-emerald-400/10", emoji: "📋" },
};

function getAgentStyle(agent: string) {
  return AGENT_STYLES[agent] ?? { color: "text-gray-300", bg: "bg-gray-300/10", emoji: "🤖" };
}

const MESSAGE_TYPE_BADGES: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  finding:        { label: "Finding",      variant: "destructive" },
  peer_review:    { label: "Peer Review",  variant: "secondary" },
  vote:           { label: "Vote",         variant: "outline" },
  escalation:     { label: "Escalation",   variant: "destructive" },
  mayor_response: { label: "Mayor",        variant: "default" },
  question:       { label: "Question",     variant: "secondary" },
  info:           { label: "Info",         variant: "outline" },
};

// ── Component ────────────────────────────────────────────────────────────────

export function AgentChat() {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [filter, setFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [chatInput, setChatInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const fetchMessages = useCallback(async () => {
    try {
      const res = await fetch("/api/agent-chat/recent?limit=100");
      if (!res.ok) return;
      const data = await res.json() as { messages: AgentMessage[] };
      setMessages(data.messages ?? []);
    } catch {
      // ignore
    }
  }, []);

  // Poll for messages
  useEffect(() => {
    fetchMessages();
    const id = setInterval(fetchMessages, 3000);
    return () => clearInterval(id);
  }, [fetchMessages]);

  // Auto-scroll on new messages
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  // WebSocket for real-time updates
  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as { type: string; payload: unknown };
        if (data.type === "batch" && Array.isArray(data.payload)) {
          for (const msg of data.payload as Array<{ type: string; payload: Record<string, unknown>; timestamp: string }>) {
            if (msg.type === "agent_message") {
              const p = msg.payload;
              setMessages(prev => [...prev.slice(-199), {
                id: String(p.id ?? ""),
                timestamp: new Date(msg.timestamp).getTime(),
                fromAgent: String(p.from ?? "unknown"),
                toAgent: String(p.to ?? "all"),
                messageType: String(p.messageType ?? "info"),
                content: String(p.content ?? ""),
                findingId: p.findingId ? String(p.findingId) : null,
                vote: p.vote ? String(p.vote) : null,
                metadata: {},
              }]);
            }
          }
        }
      } catch {
        // ignore parse errors
      }
    };

    return () => ws.close();
  }, []);

  const handleSend = async () => {
    const text = chatInput.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await fetch("/api/agent-chat/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromAgent: "mayor", toAgent: "all", messageType: "mayor_response", content: text }),
      });
      setChatInput("");
      await fetchMessages();
    } catch {
      // ignore
    } finally {
      setSending(false);
    }
  };

  // Apply filters
  const filtered = messages.filter(m => {
    if (filter !== "all" && m.fromAgent !== filter) return false;
    if (typeFilter !== "all" && m.messageType !== typeFilter) return false;
    return true;
  });

  // Get unique agents from messages
  const uniqueAgents = Array.from(new Set(messages.map(m => m.fromAgent))).sort();

  return (
    <AppLayout>
      <div className="flex flex-col h-[calc(100vh-4rem)] p-4 gap-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-white">Agent Chat</h1>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={fetchMessages}>
              <RefreshCw className="h-4 w-4 mr-1" />
              Refresh
            </Button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-2 items-center">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-[160px] h-8">
              <SelectValue placeholder="All agents" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All agents</SelectItem>
              {uniqueAgents.map(a => (
                <SelectItem key={a} value={a}>
                  {getAgentStyle(a).emoji} {a}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-[160px] h-8">
              <SelectValue placeholder="All types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {Object.entries(MESSAGE_TYPE_BADGES).map(([key, { label }]) => (
                <SelectItem key={key} value={key}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <span className="text-xs text-muted-foreground ml-auto">
            {filtered.length} message{filtered.length !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Messages */}
        <ScrollArea className="flex-1 rounded-lg border border-border bg-card/50 p-3">
          <div className="space-y-2">
            {filtered.length === 0 && (
              <p className="text-center text-muted-foreground text-sm py-8">
                No agent messages yet. Messages will appear here as agents communicate.
              </p>
            )}
            {filtered.map((m) => {
              const style = getAgentStyle(m.fromAgent);
              const badge = MESSAGE_TYPE_BADGES[m.messageType];
              const isMayor = m.fromAgent === "mayor";
              return (
                <div
                  key={m.id}
                  className={cn(
                    "rounded-md px-3 py-2 text-sm",
                    isMayor ? "bg-purple-500/10 border border-purple-500/30" : style.bg,
                  )}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-base">{style.emoji}</span>
                    <span className={cn("font-semibold text-xs", style.color)}>
                      {m.fromAgent}
                    </span>
                    {m.toAgent !== "all" && (
                      <span className="text-xs text-muted-foreground">
                        → {m.toAgent}
                      </span>
                    )}
                    {badge && (
                      <Badge variant={badge.variant} className="text-[10px] h-4 px-1">
                        {badge.label}
                      </Badge>
                    )}
                    {m.vote && (
                      <span className="text-xs">{m.vote === "up" ? "👍" : "👎"}</span>
                    )}
                    <span className="text-[10px] text-muted-foreground ml-auto">
                      {new Date(m.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  <p className="text-xs text-foreground/80 whitespace-pre-wrap">
                    {m.content}
                  </p>
                </div>
              );
            })}
            <div ref={scrollRef} />
          </div>
        </ScrollArea>

        {/* Mayor Chat input */}
        <div className="flex gap-2">
          <Input
            placeholder="Send a message as Mayor..."
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            className="flex-1"
          />
          <Button
            size="sm"
            disabled={!chatInput.trim() || sending}
            onClick={handleSend}
          >
            <Send className="h-4 w-4 mr-1" />
            Send
          </Button>
        </div>
      </div>
    </AppLayout>
  );
}
