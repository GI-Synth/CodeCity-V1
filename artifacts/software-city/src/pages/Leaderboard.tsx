import { AppLayout } from "@/components/layout/AppLayout";
import { useQuery } from "@tanstack/react-query";
import { Trophy, Medal, Star, Zap, Target, BookOpen } from "lucide-react";
import { cn } from "@/lib/utils";

interface LeaderboardAgent {
  id: string;
  name: string;
  color: string;
  level: number;
  rank: string;
  bugsFound: number;
  testsGenerated: number;
  accuracy: number;
  truePositives: number;
  falsePositives: number;
  escalationCount: number;
  kbHits: number;
  totalTasksCompleted: number;
  status: string;
}

const RANK_STYLES: Record<string, { label: string; color: string; bg: string }> = {
  principal: { label: "Principal", color: "#ff9900", bg: "rgba(255,153,0,0.15)" },
  senior: { label: "Senior", color: "#00fff7", bg: "rgba(0,255,247,0.1)" },
  mid: { label: "Mid", color: "#b026ff", bg: "rgba(176,38,255,0.1)" },
  junior: { label: "Junior", color: "#888888", bg: "rgba(136,136,136,0.08)" },
};

const PLACE_ICONS = [
  <Trophy size={18} className="text-yellow-400" />,
  <Medal size={18} className="text-slate-300" />,
  <Medal size={18} className="text-amber-600" />,
];

export function Leaderboard() {
  const { data, isLoading } = useQuery<{ agents: LeaderboardAgent[] }>({
    queryKey: ["leaderboard"],
    queryFn: () => fetch("/api/agents/leaderboard").then(r => r.json()),
    refetchInterval: 10000,
  });

  const agents = data?.agents ?? [];

  return (
    <AppLayout>
      <div className="p-8 h-full overflow-y-auto max-w-5xl mx-auto w-full">
        <div className="mb-8">
          <h1 className="text-3xl font-mono font-bold text-yellow-400 mb-2 flex items-center gap-3">
            <Trophy /> Agent Leaderboard
          </h1>
          <p className="text-muted-foreground font-mono text-sm">
            Top performers ranked by bugs found, accuracy, and tasks completed.
          </p>
        </div>

        {isLoading ? (
          <div className="text-muted-foreground font-mono text-sm animate-pulse">Loading leaderboard…</div>
        ) : agents.length === 0 ? (
          <div className="text-muted-foreground font-mono text-sm glass-panel p-8 rounded-xl text-center">
            No agents deployed yet. Spawn agents from the Agents Dashboard to start.
          </div>
        ) : (
          <div className="space-y-3">
            {agents.map((agent, idx) => {
              const rankStyle = RANK_STYLES[agent.rank] ?? RANK_STYLES.junior;
              const accuracyColor = agent.accuracy >= 0.8 ? "#00ff88" : agent.accuracy >= 0.5 ? "#ffcc00" : "#ff3333";
              return (
                <div
                  key={agent.id}
                  className={cn(
                    "glass-panel rounded-xl border p-5 flex flex-wrap items-center gap-5 transition-all duration-300",
                    idx === 0 ? "border-yellow-400/50 shadow-[0_0_20px_rgba(255,204,0,0.1)]" :
                    idx === 1 ? "border-slate-400/40" :
                    idx === 2 ? "border-amber-700/40" :
                    "border-border/40"
                  )}
                  style={{ backgroundColor: rankStyle.bg }}
                >
                  {/* Rank placement */}
                  <div className="w-8 flex items-center justify-center">
                    {idx < 3 ? PLACE_ICONS[idx] : (
                      <span className="text-muted-foreground font-mono text-sm font-bold">#{idx + 1}</span>
                    )}
                  </div>

                  {/* Agent dot */}
                  <div
                    className="w-10 h-10 rounded-full border-2 flex items-center justify-center font-mono font-bold text-sm"
                    style={{ backgroundColor: agent.color + "33", borderColor: agent.color, color: agent.color }}
                  >
                    {agent.name.slice(0, 2).toUpperCase()}
                  </div>

                  {/* Name + rank */}
                  <div className="flex-1 min-w-[120px]">
                    <div className="font-mono font-bold text-foreground">{agent.name}</div>
                    <div className="text-xs mt-0.5">
                      <span
                        className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold uppercase tracking-widest"
                        style={{ color: rankStyle.color, backgroundColor: rankStyle.bg }}
                      >
                        {rankStyle.label}
                      </span>
                      <span className="ml-2 text-muted-foreground">Lv.{agent.level}</span>
                    </div>
                  </div>

                  {/* Stats */}
                  <div className="flex flex-wrap gap-5 text-xs font-mono">
                    <StatPill icon={<Zap size={11} />} label="Bugs" value={agent.bugsFound} color="text-red-400" />
                    <StatPill icon={<Target size={11} />} label="Accuracy"
                      value={`${Math.round(agent.accuracy * 100)}%`}
                      color={accuracyColor.startsWith("#") ? undefined : accuracyColor}
                      style={{ color: accuracyColor }}
                    />
                    <StatPill icon={<Star size={11} />} label="Tasks" value={agent.totalTasksCompleted} color="text-primary" />
                    <StatPill icon={<BookOpen size={11} />} label="KB Hits" value={agent.kbHits} color="text-secondary" />
                  </div>

                  {/* Status */}
                  <div className={cn(
                    "text-[10px] font-mono uppercase tracking-widest px-2 py-0.5 rounded border",
                    agent.status === "working" ? "border-green-500/40 text-green-400" :
                    agent.status === "escalating" ? "border-yellow-500/40 text-yellow-400" :
                    "border-border/40 text-muted-foreground"
                  )}>
                    {agent.status}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppLayout>
  );
}

function StatPill({ icon, label, value, color, style }: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  color?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div className="flex flex-col items-center gap-0.5 min-w-[48px]">
      <div className={cn("flex items-center gap-1 font-bold text-sm", color)} style={style}>
        {icon} {value}
      </div>
      <div className="text-muted-foreground text-[10px] uppercase tracking-widest">{label}</div>
    </div>
  );
}
