import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useListAgents, useSpawnAgent, Agent } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Shield, Zap, Flame, Compass, MousePointer2, Plus, Terminal } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

const ROLE_CONFIG = {
  qa_inspector: { icon: Shield, color: "text-blue-400", bg: "bg-blue-400/10", label: "QA Inspector" },
  api_fuzzer: { icon: Flame, color: "text-orange-400", bg: "bg-orange-400/10", label: "API Fuzzer" },
  load_tester: { icon: Zap, color: "text-yellow-400", bg: "bg-yellow-400/10", label: "Load Tester" },
  edge_explorer: { icon: Compass, color: "text-green-400", bg: "bg-green-400/10", label: "Edge Explorer" },
  ui_navigator: { icon: MousePointer2, color: "text-purple-400", bg: "bg-purple-400/10", label: "UI Navigator" },
};

export function Agents() {
  const { data, refetch } = useListAgents({ query: { refetchInterval: 3000 } });
  const agents = data?.agents || [];

  return (
    <AppLayout>
      <div className="p-8 h-full overflow-y-auto max-w-7xl mx-auto w-full">
        <div className="flex justify-between items-end mb-8">
          <div>
            <h1 className="text-3xl font-mono font-bold text-primary text-glow mb-2">Agent Roster</h1>
            <p className="text-muted-foreground font-mono text-sm">Monitor and manage autonomous AI testers.</p>
          </div>
          <SpawnAgentDialog onSpawn={refetch} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {agents.map(agent => (
            <AgentCard key={agent.id} agent={agent} />
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

function AgentCard({ agent }: { agent: Agent }) {
  const config = ROLE_CONFIG[agent.role as keyof typeof ROLE_CONFIG] || ROLE_CONFIG.qa_inspector;
  const Icon = config.icon;

  return (
    <div className="glass-card rounded-xl p-5 flex flex-col relative overflow-hidden group">
      {/* Level Badge */}
      <div className="absolute top-0 right-0 bg-primary/20 text-primary font-mono text-[10px] px-3 py-1 rounded-bl-lg border-l border-b border-primary/30">
        LVL {agent.level}
      </div>

      <div className="flex items-center gap-4 mb-4">
        <div className={cn("p-3 rounded-lg border border-current/20", config.bg, config.color)}>
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
        {agent.status === 'working' && (
          <div className="absolute bottom-2 right-2 flex gap-1">
            <span className="w-1 h-1 bg-primary rounded-full animate-bounce" style={{ animationDelay: '0ms' }}/>
            <span className="w-1 h-1 bg-primary rounded-full animate-bounce" style={{ animationDelay: '150ms' }}/>
            <span className="w-1 h-1 bg-primary rounded-full animate-bounce" style={{ animationDelay: '300ms' }}/>
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2 border-t border-border/30 pt-4">
        <div className="text-center">
          <div className="text-[10px] text-muted-foreground font-mono uppercase">Status</div>
          <div className={cn(
            "text-xs font-mono font-bold mt-1",
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
                <span className="text-xs font-mono text-muted-foreground">Select to deploy this specialization.</span>
              </div>
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
