import { useState } from "react";
import { Building, Agent, useAssignAgentTask, useChatWithAgent } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Terminal, Shield, ShieldCheck, Flame, Activity, GitCommit, FileCode, MessageSquare, Send, Zap, FlaskConical, X, Bot, ThumbsUp, ThumbsDown, Target } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface ChatMessage {
  sender: string;
  text: string;
  source?: string;
  confidence?: number;
  offerEscalation?: boolean;
}

interface GeneratedTestProposal {
  proposalId: string;
  sourceFilePath: string;
  testFilePath: string;
  testContent: string;
  language: string;
  generationMode?: "ai" | "fallback";
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

function readArrayCount(raw: unknown): number {
  if (Array.isArray(raw)) return raw.length;
  if (typeof raw !== "string") return 0;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

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
  const [verdictPending, setVerdictPending] = useState(false);
  const [generatingScribeTest, setGeneratingScribeTest] = useState(false);
  const [approvingScribeTest, setApprovingScribeTest] = useState(false);
  const [scribeProposalOpen, setScribeProposalOpen] = useState(false);
  const [scribeProposal, setScribeProposal] = useState<GeneratedTestProposal | null>(null);
  const [scribeDraftContent, setScribeDraftContent] = useState("");

  const firstAgent = agents.length > 0 ? agents[0] : null;
  const workingAgent = agents.find(a => a.status === "working") ?? firstAgent;
  const agentId = workingAgent?.id ?? null;
  const workingAgentMemory = readArrayCount((workingAgent as any)?.visitedFiles);
  const workingAgentPatterns = readArrayCount((workingAgent as any)?.personalKB);
  const workingAgentSpecialty = Math.max(0, Math.min(100, Math.round(Number((workingAgent as any)?.specialtyScore ?? 0) * 100)));

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

  const handleGenerateScribeTest = async () => {
    if (generatingScribeTest) return;
    setGeneratingScribeTest(true);

    try {
      const res = await fetch("/api/orchestrator/generate-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ buildingId: building.id, filePath: building.filePath }),
      });

      const data = await res.json() as Partial<GeneratedTestProposal> & { error?: string; message?: string };
      if (!res.ok || !data.proposalId || !data.testFilePath || !data.testContent || !data.language || !data.sourceFilePath) {
        throw new Error(data.error ?? data.message ?? "Failed to generate test proposal");
      }

      const proposal: GeneratedTestProposal = {
        proposalId: data.proposalId,
        sourceFilePath: data.sourceFilePath,
        testFilePath: data.testFilePath,
        testContent: data.testContent,
        language: data.language,
        generationMode: data.generationMode,
      };

      setScribeProposal(proposal);
      setScribeDraftContent(proposal.testContent);
      setScribeProposalOpen(true);

      toast({
        title: "Scribe proposal ready",
        description: `${proposal.testFilePath} is ready for review and approval.`,
      });
    } catch {
      toast({ title: "Scribe test generation failed", variant: "destructive" });
    } finally {
      setGeneratingScribeTest(false);
    }
  };

  const clearScribeProposal = () => {
    setScribeProposalOpen(false);
    setScribeProposal(null);
    setScribeDraftContent("");
  };

  const handleApproveScribeTest = async () => {
    if (!scribeProposal) return;

    setApprovingScribeTest(true);
    try {
      const res = await fetch("/api/orchestrator/approve-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proposalId: scribeProposal.proposalId,
          testContent: scribeDraftContent,
          overwrite: true,
        }),
      });

      const data = await res.json() as { success?: boolean; error?: string; message?: string; testFilePath?: string };
      if (!res.ok || !data.success) {
        throw new Error(data.error ?? data.message ?? "Failed to approve test proposal");
      }

      toast({
        title: "Test approved",
        description: `${data.testFilePath ?? scribeProposal.testFilePath} was written to the local repo.`,
      });
      clearScribeProposal();
    } catch {
      toast({ title: "Approval failed", description: "Ensure local watch mode is active for file writes.", variant: "destructive" });
    } finally {
      setApprovingScribeTest(false);
    }
  };

  const handleTargetBuilding = async () => {
    if (!agentId) {
      toast({ title: "No agents available", description: "Spawn an agent first.", variant: "destructive" });
      return;
    }
    try {
      const res = await fetch(`/api/agents/${agentId}/task`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskType: "analyze_bug", buildingId: building.id, context: `Targeted inspection of ${building.name}` }),
      });
      if (!res.ok) throw new Error("Target failed");
      toast({ title: "Agent targeted", description: `${workingAgent?.name} is now inspecting ${building.name}` });
    } catch {
      toast({ title: "Failed to target building", variant: "destructive" });
    }
  };

  const handleVerdict = async (verdict: "true_positive" | "false_positive") => {
    if (!agentId) {
      toast({ title: "No agent to rate", variant: "destructive" });
      return;
    }
    setVerdictPending(true);
    try {
      const res = await fetch(`/api/agents/${agentId}/verdict`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verdict }),
      });
      if (!res.ok) throw new Error();
      const result = await res.json() as { accuracy: number };
      toast({
        title: verdict === "true_positive" ? "Marked as real bug" : "Marked as false positive",
        description: `Agent accuracy updated to ${Math.round(result.accuracy * 100)}%`,
      });
    } catch {
      toast({ title: "Failed to record verdict", variant: "destructive" });
    } finally {
      setVerdictPending(false);
    }
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
    <>
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
          <div className="flex items-center justify-between bg-primary/5 px-2 py-1.5 rounded border border-primary/10">
            <div className="text-[10px] font-mono text-muted-foreground flex items-center gap-1.5">
              <Bot size={11} className="text-primary" />
              <span className="text-primary">{workingAgent.name}</span>
              <span>({workingAgent.role.replace("_", " ")}) assigned</span>
              <span className="text-primary/70">mem {workingAgentMemory}</span>
              <span className="text-primary/70">patterns {workingAgentPatterns}</span>
              <span className="text-primary/70">spec {workingAgentSpecialty}%</span>
            </div>
            <button
              onClick={handleTargetBuilding}
              className="flex items-center gap-1 text-[10px] font-mono text-primary/70 hover:text-primary transition-colors border border-primary/20 hover:border-primary/40 rounded px-1.5 py-0.5"
              title="Target this building for inspection"
            >
              <Target size={10} /> Focus
            </button>
          </div>
        )}

        <div className="space-y-2">
          <h3 className="font-mono text-xs uppercase text-muted-foreground tracking-wider">Agent Actions</h3>
          <div className="grid grid-cols-3 gap-2">
            <Button variant="outline" size="sm" onClick={() => handleTask("analyze_bug")} disabled={assignTaskMutation.isPending || !agentId} className="flex flex-col h-14 gap-1">
              <Activity size={14} /> <span className="text-[10px]">Analyze</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => { void handleGenerateScribeTest(); }}
              disabled={generatingScribeTest}
              className="flex flex-col h-14 gap-1"
            >
              <Shield size={14} /> <span className="text-[10px]">Scribe Test</span>
            </Button>
            <Button variant="outline" size="sm" onClick={() => handleTask("fuzz_api")} disabled={assignTaskMutation.isPending || !agentId} className="flex flex-col h-14 gap-1">
              <FlaskConical size={14} /> <span className="text-[10px]">Fuzz</span>
            </Button>
          </div>
          {(assignTaskMutation.isPending || generatingScribeTest) && (
            <div className="text-xs text-primary font-mono animate-pulse flex items-center gap-2">
              <Zap size={12} /> {generatingScribeTest ? "Scribe drafting proposal..." : "Agent dispatched..."}
            </div>
          )}
          {scribeProposal && (
            <div className="text-[10px] font-mono text-primary/80 rounded border border-primary/20 bg-primary/5 px-2 py-1">
              Draft ready: {scribeProposal.testFilePath}
            </div>
          )}
        </div>

        {/* Verdict buttons — rate last bug finding */}
        {agentId && (
          <div className="space-y-2">
            <h3 className="font-mono text-xs uppercase text-muted-foreground tracking-wider">Rate Last Finding</h3>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleVerdict("true_positive")}
                disabled={verdictPending}
                className="flex-1 h-9 border-green-400/30 text-green-400 hover:bg-green-400/10 text-xs font-mono gap-1.5"
              >
                <ThumbsUp size={12} /> Real Bug
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleVerdict("false_positive")}
                disabled={verdictPending}
                className="flex-1 h-9 border-orange-400/30 text-orange-400 hover:bg-orange-400/10 text-xs font-mono gap-1.5"
              >
                <ThumbsDown size={12} /> False +
              </Button>
            </div>
            <p className="text-[10px] font-mono text-muted-foreground/50">
              Voting updates the agent's accuracy score
            </p>
          </div>
        )}

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

      <Dialog
        open={scribeProposalOpen}
        onOpenChange={(open) => {
          if (!open && !approvingScribeTest) {
            clearScribeProposal();
            return;
          }
          setScribeProposalOpen(open);
        }}
      >
        <DialogContent className="max-w-3xl border-primary/40 bg-background/95 font-mono">
          <DialogHeader>
            <DialogTitle className="text-primary">Scribe Test Proposal</DialogTitle>
          </DialogHeader>

          <div className="space-y-1 text-xs text-muted-foreground">
            <div>Source: {scribeProposal?.sourceFilePath ?? "n/a"}</div>
            <div>Target: {scribeProposal?.testFilePath ?? "n/a"}</div>
            <div>Mode: {scribeProposal?.generationMode === "fallback" ? "Fallback scaffold" : "AI generated"}</div>
          </div>

          <textarea
            value={scribeDraftContent}
            onChange={(event) => setScribeDraftContent(event.target.value)}
            className="min-h-[320px] w-full rounded border border-border/40 bg-black/35 p-3 text-xs leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-primary/50"
            spellCheck={false}
          />

          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={clearScribeProposal}
              disabled={approvingScribeTest}
              className="h-8 text-xs font-mono"
            >
              Cancel
            </Button>
            <Button
              onClick={() => { void handleApproveScribeTest(); }}
              disabled={approvingScribeTest || !scribeDraftContent.trim()}
              className="h-8 text-xs font-mono"
            >
              {approvingScribeTest ? "Approving..." : "Approve and Write File"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
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
