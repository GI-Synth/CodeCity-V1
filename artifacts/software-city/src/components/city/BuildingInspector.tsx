import { useState } from "react";
import { Building, Agent, useAssignAgentTask, useChatWithAgent } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Terminal, Shield, ShieldCheck, Flame, Activity, GitCommit, FileCode, MessageSquare, Send, Zap, FlaskConical, X, Bot } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface ChatMessage {
  sender: string;
  text: string;
  source?: string;
  confidence?: number;
  offerEscalation?: boolean;
}

const SOURCE_COLORS: Record<string, string> = {
  local: "text-primary bg-primary/10 border-primary/30",
  knowledge_base: "text-yellow-400 bg-yellow-400/10 border-yellow-400/30",
  groq: "text-orange-400 bg-orange-400/10 border-orange-400/30",
  anthropic: "text-orange-300 bg-orange-300/10 border-orange-300/30",
  fallback: "text-muted-foreground bg-muted/10 border-border/30",
};

const SOURCE_LABELS: Record<string, string> = {
  local: "LOCAL AI",
  knowledge_base: "KB CACHE",
  groq: "GROQ",
  anthropic: "CLAUDE",
  fallback: "FALLBACK",
};

export function BuildingInspector({
  building,
  agents,
  onClose,
}: {
  building: Building;
  agents: Agent[];
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [chatMsg, setChatMsg] = useState("");
  const [chatLog, setChatLog] = useState<ChatMessage[]>([]);
  const [pendingEscalation, setPendingEscalation] = useState(false);

  const firstAgent = agents.length > 0 ? agents[0] : null;
  const workingAgent = agents.find(a => a.status === "working") ?? firstAgent;
  const agentId = workingAgent?.id ?? null;

  const assignTaskMutation = useAssignAgentTask({
    mutation: {
      onSuccess: (data) => {
        toast({
          title: "Task Assigned",
          description: `${data.taskType} completed. Found ${data.bugsFound} bug(s).`,
          variant: data.success ? "default" : "destructive",
        });
      },
    },
  });

  const chatMutation = useChatWithAgent({
    mutation: {
      onSuccess: (data: any) => {
        const msg: ChatMessage = {
          sender: data.agentName ?? "Agent",
          text: data.message,
          source: data.source,
          confidence: data.confidence,
          offerEscalation: data.offerEscalation,
        };
        setChatLog(prev => [...prev, msg]);
        setPendingEscalation(data.offerEscalation === true);
      },
    },
  });

  const handleTask = (type: "analyze_bug" | "generate_tests" | "fuzz_api" | "load_test" | "explore_edge_cases") => {
    if (!agentId) {
      toast({ title: "No agents available", description: "Spawn an agent first.", variant: "destructive" });
      return;
    }
    assignTaskMutation.mutate({
      agentId,
      data: { taskType: type, buildingId: building.id, context: "Perform analysis on " + building.name },
    });
  };

  const handleChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatMsg.trim()) return;
    if (!agentId) {
      toast({ title: "No agents available", variant: "destructive" });
      return;
    }
    setChatLog(prev => [...prev, { sender: "You", text: chatMsg }]);
    chatMutation.mutate({
      agentId,
      data: {
        message: chatMsg,
        buildingContext: building.filePath,
        buildingContent: `File: ${building.filePath}\nLanguage: ${building.language}\nLOC: ${building.linesOfCode}\nComplexity: ${building.complexity}`,
        buildingLanguage: building.language,
      },
    });
    setChatMsg("");
    setPendingEscalation(false);
  };

  const handleEscalate = () => {
    if (!agentId) return;
    setChatLog(prev => [...prev, { sender: "You", text: "yes escalate" }]);
    chatMutation.mutate({
      agentId,
      data: {
        message: "yes escalate",
        buildingContext: building.filePath,
        buildingLanguage: building.language,
      },
    });
    setPendingEscalation(false);
  };

  return (
    <div className="w-96 flex flex-col h-full glass-panel border-l border-primary/30 z-10 shadow-2xl relative animate-in slide-in-from-right">
      <div className="p-4 border-b border-primary/20 bg-primary/5 flex justify-between items-start">
        <div>
          <h2 className="font-mono text-xl font-bold text-primary flex items-center gap-2">
            <FileCode size={20} />
            {building.name}
          </h2>
          <p className="text-xs text-muted-foreground font-mono mt-1 break-all">{building.filePath}</p>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-primary">
          <X size={20} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        <div className="grid grid-cols-2 gap-4">
          <StatBox label="Language" value={building.language} />
          <StatBox label="Age" value={building.age} />
          <StatBox label="Lines of Code" value={building.linesOfCode.toString()} />
          <StatBox label="Complexity" value={building.complexity.toString()} />
        </div>

        <div className="space-y-2 bg-black/40 p-3 rounded border border-border/50">
          <div className="flex justify-between items-center text-sm font-mono">
            <span className="text-muted-foreground flex items-center gap-2"><Shield size={14} /> Test Coverage</span>
            <span className={building.testCoverage > 0.8 ? "text-success" : "text-warning"}>
              {Math.round(building.testCoverage * 100)}%
            </span>
          </div>
          <div className="h-2 bg-background rounded-full overflow-hidden">
            <div
              className={cn("h-full transition-all", building.testCoverage > 0.8 ? "bg-success" : "bg-warning")}
              style={{ width: `${Math.round(building.testCoverage * 100)}%` }}
            />
          </div>
        </div>

        <div className="space-y-2">
          <h3 className="font-mono text-xs uppercase text-muted-foreground tracking-wider">Current Status</h3>
          <div className="flex gap-2 flex-wrap">
            {building.activeEvent ? (
              <span className="px-3 py-1 rounded bg-destructive/20 border border-destructive text-destructive font-mono text-xs animate-pulse flex items-center gap-2">
                <Flame size={14} /> ACTIVE {building.activeEvent.toUpperCase()}
              </span>
            ) : (
              <span className="px-3 py-1 rounded bg-success/20 border border-success text-success font-mono text-xs flex items-center gap-2">
                <ShieldCheck size={14} /> HEALTHY
              </span>
            )}
            <span className="px-3 py-1 rounded bg-primary/10 border border-primary/30 text-primary font-mono text-xs flex items-center gap-2">
              <GitCommit size={14} /> {building.commitCount} Commits
            </span>
          </div>
        </div>

        {workingAgent && (
          <div className="text-[10px] font-mono text-muted-foreground flex items-center gap-1.5 bg-primary/5 px-2 py-1.5 rounded border border-primary/10">
            <Bot size={11} className="text-primary" />
            <span className="text-primary">{workingAgent.name}</span>
            <span>({workingAgent.role.replace("_", " ")}) assigned</span>
          </div>
        )}

        <div className="space-y-2">
          <h3 className="font-mono text-xs uppercase text-muted-foreground tracking-wider">Agent Actions</h3>
          <div className="grid grid-cols-3 gap-2">
            <Button variant="outline" size="sm" onClick={() => handleTask("analyze_bug")} disabled={assignTaskMutation.isPending || !agentId} className="flex flex-col h-14 gap-1">
              <Activity size={14} /> <span className="text-[10px]">Analyze</span>
            </Button>
            <Button variant="outline" size="sm" onClick={() => handleTask("generate_tests")} disabled={assignTaskMutation.isPending || !agentId} className="flex flex-col h-14 gap-1">
              <Shield size={14} /> <span className="text-[10px]">Gen Tests</span>
            </Button>
            <Button variant="outline" size="sm" onClick={() => handleTask("fuzz_api")} disabled={assignTaskMutation.isPending || !agentId} className="flex flex-col h-14 gap-1">
              <FlaskConical size={14} /> <span className="text-[10px]">Fuzz</span>
            </Button>
          </div>
          {assignTaskMutation.isPending && (
            <div className="text-xs text-primary font-mono animate-pulse flex items-center gap-2">
              <Zap size={12} /> Agent dispatched...
            </div>
          )}
        </div>

        <div className="border border-primary/20 rounded-lg overflow-hidden flex flex-col h-64 bg-black/40">
          <div className="bg-primary/10 p-2 border-b border-primary/20 text-xs font-mono text-primary flex items-center gap-2">
            <MessageSquare size={14} /> Inspector Chat
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-2 text-xs font-mono">
            {chatLog.length === 0 ? (
              <div className="text-muted-foreground/50 text-center mt-10">Ask a question to begin.</div>
            ) : (
              chatLog.map((msg, i) => (
                <div key={i} className={cn("p-2 rounded", msg.sender === "You" ? "bg-primary/10 ml-4" : "bg-muted mr-4")}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-muted-foreground">{msg.sender}</span>
                    {msg.source && (
                      <span className={cn("text-[9px] px-1.5 py-0.5 rounded border font-mono", SOURCE_COLORS[msg.source] ?? SOURCE_COLORS.fallback)}>
                        {SOURCE_LABELS[msg.source] ?? msg.source}
                        {msg.confidence !== undefined && ` ${Math.round(msg.confidence * 100)}%`}
                      </span>
                    )}
                  </div>
                  <div className="text-foreground whitespace-pre-wrap">{msg.text}</div>
                  {msg.offerEscalation && (
                    <button
                      onClick={handleEscalate}
                      className="mt-2 px-2 py-1 rounded bg-orange-400/10 border border-orange-400/30 text-orange-400 text-[10px] font-mono hover:bg-orange-400/20 transition-colors"
                    >
                      Yes, ask senior AI
                    </button>
                  )}
                </div>
              ))
            )}
            {chatMutation.isPending && <div className="text-primary animate-pulse ml-4">Agent typing...</div>}
          </div>

          <form onSubmit={handleChat} className="p-2 border-t border-primary/20 flex gap-2">
            <input
              type="text"
              value={chatMsg}
              onChange={e => setChatMsg(e.target.value)}
              placeholder="Ask agent..."
              className="flex-1 bg-background border border-border rounded px-2 py-1 text-xs font-mono focus:outline-none focus:border-primary text-foreground"
            />
            <Button type="submit" size="icon" variant="ghost" className="h-7 w-7 text-primary hover:bg-primary/20" disabled={chatMutation.isPending || !agentId}>
              <Send size={14} />
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-black/40 p-3 rounded border border-border/50">
      <div className="text-[10px] uppercase text-muted-foreground font-mono tracking-wider mb-1">{label}</div>
      <div className="font-mono text-lg text-foreground">{value}</div>
    </div>
  );
}
