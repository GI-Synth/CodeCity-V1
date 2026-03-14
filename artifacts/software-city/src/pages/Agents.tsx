import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useListAgents, useSpawnAgent, Agent } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Shield, Zap, Flame, Compass, MousePointer2, Plus, Terminal, Pause, Play, PauseOctagon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

const ROLE_CONFIG = {
  qa_inspector: { icon: Shield, color: "text-blue-400", bg: "bg-blue-400/10", label: "QA Inspector", specialty: "Static bug triage" },
  api_fuzzer: { icon: Flame, color: "text-orange-400", bg: "bg-orange-400/10", label: "API Fuzzer", specialty: "Malformed request probing" },
  load_tester: { icon: Zap, color: "text-yellow-400", bg: "bg-yellow-400/10", label: "Load Tester", specialty: "Concurrency pressure checks" },
  edge_explorer: { icon: Compass, color: "text-green-400", bg: "bg-green-400/10", label: "Edge Explorer", specialty: "Boundary condition mapping" },
  ui_navigator: { icon: MousePointer2, color: "text-purple-400", bg: "bg-purple-400/10", label: "UI Navigator", specialty: "User-flow weakness hunting" },
  scribe: { icon: Terminal, color: "text-emerald-400", bg: "bg-emerald-400/10", label: "Scribe", specialty: "Healing-loop test authoring" },
};

function parseArrayCount(raw: unknown): number {
  if (Array.isArray(raw)) return raw.length;
  if (!raw || typeof raw !== "string") return 0;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return 0;
    return parsed.length;
  } catch {
    return 0;
  }
}

function specialtyPercent(raw: unknown): number {
  const value = typeof raw === "number" ? raw : Number(raw ?? 0);
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value * 100)));
}

export function Agents() {
  const { toast } = useToast();
  const { data, refetch } = useListAgents({ query: { refetchInterval: 3000 } });
  const agents = data?.agents || [];
  const [pausingAll, setPausingAll] = useState(false);

  const anyActive = agents.some(a => a.status !== "paused" && a.status !== "retired");

  const handlePauseAll = async () => {
    setPausingAll(true);
    try {
      const res = await fetch("/api/agents/pause-all", { method: "PATCH" });
      if (!res.ok) throw new Error();
      const result = await res.json() as { paused: boolean };
      toast({ title: result.paused ? "All agents paused" : "All agents resumed" });
      refetch();
    } catch {
      toast({ title: "Failed to toggle agent state", variant: "destructive" });
    } finally {
      setPausingAll(false);
    }
  };

  return (
    <AppLayout>
      <div className="p-8 h-full overflow-y-auto max-w-7xl mx-auto w-full">
        <div className="flex justify-between items-end mb-8 flex-wrap gap-4">
          <div>
            <h1 className="text-3xl font-mono font-bold text-primary text-glow mb-2">Agent Roster</h1>
            <p className="text-muted-foreground font-mono text-sm">Monitor and manage autonomous AI testers.</p>
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={handlePauseAll}
              disabled={pausingAll || agents.length === 0}
              className={cn(
                "h-9 font-mono border gap-2",
                anyActive ? "border-yellow-400/40 text-yellow-400 hover:bg-yellow-400/10" : "border-green-400/40 text-green-400 hover:bg-green-400/10"
              )}
            >
              {anyActive ? <PauseOctagon size={14} /> : <Play size={14} />}
              {anyActive ? "Pause All" : "Resume All"}
            </Button>
            <SpawnAgentDialog onSpawn={refetch} />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {agents.map(agent => (
            <AgentCard key={agent.id} agent={agent} onRefetch={refetch} />
          ))}
          {agents.length === 0 && (
            <div className="col-span-full py-20 text-center glass-panel rounded-xl text-muted-foreground font-mono">
              <Terminal size={32} className="mx-auto mb-4 opacity-50" />
              No active agents. Spawn one to begin testing.
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}

function AgentCard({ agent, onRefetch }: { agent: Agent; onRefetch: () => void }) {
  const { toast } = useToast();
  const [pausing, setPausing] = useState(false);
  const config = ROLE_CONFIG[agent.role as keyof typeof ROLE_CONFIG] || ROLE_CONFIG.qa_inspector;
  const Icon = config.icon;
  const isPaused = agent.status === "paused";
  const visitedFilesCount = parseArrayCount((agent as any).visitedFiles);
  const patternCount = parseArrayCount((agent as any).personalKB);
  const specialty = specialtyPercent((agent as any).specialtyScore);
  const lastHash = typeof (agent as any).lastFileHash === "string" ? (agent as any).lastFileHash as string : "";

  const handleTogglePause = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setPausing(true);
    try {
      const res = await fetch(`/api/agents/${agent.id}/pause`, { method: "PATCH" });
      if (!res.ok) throw new Error();
      const result = await res.json() as { paused: boolean };
      toast({ title: result.paused ? `${agent.name} paused` : `${agent.name} resumed` });
      onRefetch();
    } catch {
      toast({ title: "Failed to toggle agent", variant: "destructive" });
    } finally {
      setPausing(false);
    }
  };

  return (
    <div className={cn(
      "glass-card rounded-xl p-5 flex flex-col relative overflow-hidden group transition-all",
      isPaused && "opacity-70 border-yellow-400/20"
    )}>
      {/* Level Badge */}
      <div className="absolute top-0 right-0 bg-primary/20 text-primary font-mono text-[10px] px-3 py-1 rounded-bl-lg border-l border-b border-primary/30">
        LVL {agent.level}
      </div>

      {isPaused && (
        <div className="absolute top-0 left-0 bg-yellow-400/20 text-yellow-400 font-mono text-[9px] px-2 py-1 rounded-br-lg border-r border-b border-yellow-400/30 uppercase tracking-wider flex items-center gap-1">
          <Pause size={9} /> paused
        </div>
      )}

      <div className="flex items-center gap-4 mb-4">
        <div className={cn("p-3 rounded-lg border border-current/20", config.bg, config.color, isPaused && "grayscale")}>
          <Icon size={24} />
        </div>
        <div>
          <h3 className="font-mono font-bold text-foreground text-lg">{agent.name}</h3>
          <p className={cn("text-xs font-mono uppercase tracking-wider", config.color)}>{config.label}</p>
        </div>
      </div>

      <div className="bg-black/50 rounded p-3 mb-4 border border-border/50 flex-1 relative">
        <div className="text-[10px] text-muted-foreground font-mono uppercase mb-1 flex items-center gap-2">
          <Terminal size={12}/> Current Thought
        </div>
        <p className="text-xs font-mono text-foreground/80 italic leading-relaxed">
          "{agent.dialogue}"
        </p>
        <div className="mt-2 border-t border-border/30 pt-2">
          <div className="text-[10px] font-mono text-muted-foreground">Focus: {config.specialty}</div>
          <div className="mt-1 h-1.5 w-full rounded bg-black/60 overflow-hidden">
            <div className="h-full bg-primary/80 transition-all" style={{ width: `${specialty}%` }} />
          </div>
          <div className="mt-1 text-[10px] font-mono text-primary/80">Specialty Score {specialty}%</div>
          <div className="mt-1 text-[10px] font-mono text-muted-foreground/80 flex gap-3">
            <span>Memory {visitedFilesCount}</span>
            <span>Patterns {patternCount}</span>
            {lastHash ? <span>Hash {lastHash.slice(0, 8)}</span> : <span>Hash n/a</span>}
          </div>
        </div>
        {agent.status === 'working' && (
          <div className="absolute bottom-2 right-2 flex gap-1">
            <span className="w-1 h-1 bg-primary rounded-full animate-bounce" style={{ animationDelay: '0ms' }}/>
            <span className="w-1 h-1 bg-primary rounded-full animate-bounce" style={{ animationDelay: '150ms' }}/>
            <span className="w-1 h-1 bg-primary rounded-full animate-bounce" style={{ animationDelay: '300ms' }}/>
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2 border-t border-border/30 pt-4 mb-4">
        <div className="text-center">
          <div className="text-[10px] text-muted-foreground font-mono uppercase">Status</div>
          <div className={cn(
            "text-xs font-mono font-bold mt-1",
            agent.status === 'paused' ? "text-yellow-400" :
            agent.status === 'idle' ? "text-muted-foreground" :
            agent.status === 'escalating' ? "text-warning" : "text-success"
          )}>
            {agent.status}
          </div>
        </div>
        <div className="text-center border-l border-border/30">
          <div className="text-[10px] text-muted-foreground font-mono uppercase">Bugs Found</div>
          <div className="text-xs font-mono font-bold mt-1 text-destructive">{agent.bugsFound}</div>
        </div>
        <div className="text-center border-l border-border/30">
          <div className="text-[10px] text-muted-foreground font-mono uppercase">Accuracy</div>
          <div className="text-xs font-mono font-bold mt-1 text-primary">{Math.round(agent.accuracy * 100)}%</div>
        </div>
      </div>

      <Button
        variant="outline"
        size="sm"
        onClick={handleTogglePause}
        disabled={pausing || agent.status === "retired"}
        className={cn(
          "w-full h-7 text-[11px] font-mono gap-1.5",
          isPaused ? "border-green-400/30 text-green-400 hover:bg-green-400/10" : "border-yellow-400/30 text-yellow-400 hover:bg-yellow-400/10"
        )}
      >
        {isPaused ? <><Play size={11} /> Resume</> : <><Pause size={11} /> Pause</>}
      </Button>
    </div>
  );
}

function SpawnAgentDialog({ onSpawn }: { onSpawn: () => void }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const spawnMutation = useSpawnAgent({
    mutation: {
      onSuccess: () => {
        toast({ title: "Success", description: "Agent spawned successfully." });
        setOpen(false);
        onSpawn();
      },
      onError: () => toast({ title: "Error", description: "Failed to spawn agent.", variant: "destructive" })
    }
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="default" className="gap-2">
          <Plus size={16} /> Spawn Agent
        </Button>
      </DialogTrigger>
      <DialogContent className="glass-panel border-primary/50 text-foreground sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="font-mono text-primary text-glow text-xl">Initialize New Agent</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-4 py-4">
          {Object.entries(ROLE_CONFIG).map(([role, config]) => (
            <Button
              key={role}
              variant="outline"
              className="justify-start h-16 px-4 group bg-black/40 hover:bg-primary/10 border-border/50 hover:border-primary/50"
              onClick={() => spawnMutation.mutate({ data: { role: role as any } })}
              disabled={spawnMutation.isPending}
            >
              <config.icon className={cn("mr-4", config.color)} size={24} />
              <div className="flex flex-col items-start text-left">
                <span className="font-mono font-bold text-foreground group-hover:text-primary transition-colors">{config.label}</span>
                <span className="text-xs font-mono text-muted-foreground">{config.specialty}</span>
              </div>
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
