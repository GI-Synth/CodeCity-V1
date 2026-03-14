import { useQuery } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { cn } from "@/lib/utils";
import { Activity, Bug, Brain, Zap, RefreshCw, TrendingUp, TrendingDown, Cpu, Server } from "lucide-react";
import { format } from "date-fns";
import { useState } from "react";

interface MetricSnapshot {
  id: number;
  timestamp: string;
  healthScore: number;
  coverageOverall: number;
  activeAgents: number;
  pausedAgents: number;
  totalBugs: number;
  kbHitRate: number;
  tasksCompleted: number;
  escalationsToday: number;
  cpuUsage: number;
  memoryMb: number;
}

interface MetricsHistory {
  snapshots: MetricSnapshot[];
  hours: number;
  count: number;
}

interface LiveMetrics {
  timestamp: string;
  cpuUsage: number;
  memoryUsage: number;
  activeAgents: number;
  bugsFound: number;
  testsRun: number;
  escalations: number;
  knowledgeBaseHits: number;
}

interface CityHealth {
  score: number;
  season: string;
  testCoverageRatio: number;
  cleanBuildingRatio: number;
  avgComplexity: number;
  testFileRatio: number;
}

interface KnowledgeSessionStats {
  kbHits: number;
  kbMisses: number;
  kbHitRate: number;
  totalEscalations: number;
  vectorHits: number;
  keywordHits: number;
  avgSimilarity: number;
  vectorCacheSize: number;
  modelLoaded: boolean;
}

function StatCard({
  label,
  value,
  unit,
  icon: Icon,
  trend,
  color = "primary",
}: {
  label: string;
  value: string | number;
  unit?: string;
  icon: React.ElementType;
  trend?: "up" | "down" | "neutral";
  color?: "primary" | "green" | "red" | "orange" | "blue";
}) {
  const colors = {
    primary: "text-primary border-primary/30 bg-primary/5",
    green: "text-green-400 border-green-400/30 bg-green-400/5",
    red: "text-red-400 border-red-400/30 bg-red-400/5",
    orange: "text-orange-400 border-orange-400/30 bg-orange-400/5",
    blue: "text-blue-400 border-blue-400/30 bg-blue-400/5",
  };
  return (
    <div className={cn("rounded-xl border p-5 flex flex-col gap-3", colors[color])}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">{label}</span>
        <Icon size={16} className={cn("opacity-70", colors[color].split(" ")[0])} />
      </div>
      <div className="flex items-end gap-1.5">
        <span className={cn("text-3xl font-mono font-bold", colors[color].split(" ")[0])}>{value}</span>
        {unit && <span className="text-sm text-muted-foreground mb-0.5 font-mono">{unit}</span>}
        {trend === "up" && <TrendingUp size={14} className="text-green-400 mb-1 ml-1" />}
        {trend === "down" && <TrendingDown size={14} className="text-red-400 mb-1 ml-1" />}
      </div>
    </div>
  );
}

function SVGLineChart({
  data,
  width = 600,
  height = 180,
  label = "Value",
  color = "#00fff7",
}: {
  data: { time: string; value: number }[];
  width?: number;
  height?: number;
  label?: string;
  color?: string;
}) {
  if (data.length < 2) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm font-mono">
        Collecting data... check back in 30 seconds.
      </div>
    );
  }

  const PAD = { top: 16, right: 24, bottom: 32, left: 48 };
  const W = width - PAD.left - PAD.right;
  const H = height - PAD.top - PAD.bottom;

  const values = data.map(d => d.value);
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const range = maxV - minV || 1;

  const xOf = (i: number) => (i / (data.length - 1)) * W;
  const yOf = (v: number) => H - ((v - minV) / range) * H;

  const pathD = data.map((d, i) => `${i === 0 ? "M" : "L"} ${xOf(i)} ${yOf(d.value)}`).join(" ");
  const areaD = `${pathD} L ${xOf(data.length - 1)} ${H} L 0 ${H} Z`;

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map(t => ({
    y: H - t * H,
    label: (minV + t * range).toFixed(1),
  }));

  const tickStep = Math.ceil(data.length / 6);
  const timeTicks = data.filter((_, i) => i % tickStep === 0 || i === data.length - 1);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full overflow-visible">
      <defs>
        <linearGradient id={`grad-${label}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0.01" />
        </linearGradient>
      </defs>
      <g transform={`translate(${PAD.left},${PAD.top})`}>
        {gridLines.map(({ y, label: gl }) => (
          <g key={y}>
            <line x1={0} y1={y} x2={W} y2={y} stroke="rgba(255,255,255,0.06)" strokeDasharray="4,4" />
            <text x={-6} y={y + 4} textAnchor="end" fontSize={9} fill="rgba(255,255,255,0.35)" fontFamily="monospace">{gl}</text>
          </g>
        ))}
        <path d={areaD} fill={`url(#grad-${label})`} />
        <path d={pathD} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {data.length < 50 && data.map((d, i) => (
          <circle key={i} cx={xOf(i)} cy={yOf(d.value)} r={2.5} fill={color} opacity={0.8} />
        ))}
        {timeTicks.map((d, i) => {
          const idx = data.indexOf(d);
          return (
            <text key={i} x={xOf(idx)} y={H + 20} textAnchor="middle" fontSize={9} fill="rgba(255,255,255,0.35)" fontFamily="monospace">
              {format(new Date(d.time), "HH:mm")}
            </text>
          );
        })}
      </g>
    </svg>
  );
}

export function Metrics() {
  const [hours, setHours] = useState(24);

  const { data: history, refetch: refetchHistory, isFetching: fetchingHistory } = useQuery<MetricsHistory>({
    queryKey: ["metricsHistory", hours],
    queryFn: async () => {
      const res = await fetch(`/api/metrics/history?hours=${hours}`);
      if (!res.ok) throw new Error("Failed to fetch metrics history");
      return res.json() as Promise<MetricsHistory>;
    },
    refetchInterval: 30_000,
  });

  const { data: live } = useQuery<LiveMetrics>({
    queryKey: ["liveMetrics"],
    queryFn: async () => {
      const res = await fetch("/api/city/metrics");
      if (!res.ok) throw new Error("Failed to fetch live metrics");
      return res.json() as Promise<LiveMetrics>;
    },
    refetchInterval: 10_000,
  });

  const { data: health } = useQuery<CityHealth>({
    queryKey: ["cityHealth"],
    queryFn: async () => {
      const res = await fetch("/api/city/health");
      if (!res.ok) throw new Error("Failed to fetch city health");
      return res.json() as Promise<CityHealth>;
    },
    refetchInterval: 15_000,
  });

  const { data: knowledgeSessionStats } = useQuery<KnowledgeSessionStats>({
    queryKey: ["knowledgeSessionStats"],
    queryFn: async () => {
      const res = await fetch("/api/knowledge/session-stats");
      if (!res.ok) throw new Error("Failed to fetch knowledge session stats");
      return res.json() as Promise<KnowledgeSessionStats>;
    },
    refetchInterval: 10_000,
  });

  const snapshots = history?.snapshots ?? [];
  const healthChartData = snapshots.map(s => ({ time: s.timestamp, value: s.healthScore }));
  const agentsChartData = snapshots.map(s => ({ time: s.timestamp, value: s.activeAgents }));
  const bugsChartData = snapshots.map(s => ({ time: s.timestamp, value: s.totalBugs }));

  const lastSnap = snapshots[snapshots.length - 1];
  const healthScore = health?.score ?? lastSnap?.healthScore ?? 0;
  const coverage = health?.testCoverageRatio ?? lastSnap?.coverageOverall ?? 0;
  const activeAgents = live?.activeAgents ?? lastSnap?.activeAgents ?? 0;
  const totalBugs = live?.bugsFound ?? lastSnap?.totalBugs ?? 0;
  const cpuUsage = live?.cpuUsage ?? lastSnap?.cpuUsage ?? 0;
  const memMb = live?.memoryUsage ?? lastSnap?.memoryMb ?? 0;
  const kbHits = live?.knowledgeBaseHits ?? 0;
  const escalations = live?.escalations ?? lastSnap?.escalationsToday ?? 0;
  const vectorCacheSize = knowledgeSessionStats?.vectorCacheSize ?? 0;
  const vectorHits = knowledgeSessionStats?.vectorHits ?? 0;
  const keywordHits = knowledgeSessionStats?.keywordHits ?? 0;
  const avgSimilarityPercent = ((knowledgeSessionStats?.avgSimilarity ?? 0) * 100).toFixed(1);
  const modelLoaded = knowledgeSessionStats?.modelLoaded ?? false;

  const season = health?.season ?? "summer";
  const seasonEmoji = season === "winter" ? "❄️" : season === "fall" ? "🍂" : season === "spring" ? "🌱" : "☀️";

  return (
    <AppLayout>
      <div className="flex-1 overflow-y-auto bg-background">
        <div className="max-w-7xl mx-auto p-6 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-mono font-bold text-primary text-glow">Live Metrics</h1>
              <p className="text-sm text-muted-foreground font-mono mt-1">
                City health & agent performance — {seasonEmoji} {season} season
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex gap-1">
                {[6, 24, 48].map(h => (
                  <button
                    key={h}
                    onClick={() => setHours(h)}
                    className={cn(
                      "px-3 py-1.5 text-xs font-mono rounded border transition-colors",
                      hours === h
                        ? "border-primary/50 bg-primary/10 text-primary"
                        : "border-border/50 text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {h}h
                  </button>
                ))}
              </div>
              <button
                onClick={() => { void refetchHistory(); }}
                disabled={fetchingHistory}
                className="flex items-center gap-2 px-3 py-1.5 text-xs font-mono rounded border border-primary/30 text-primary hover:bg-primary/10 transition-colors disabled:opacity-50"
              >
                <RefreshCw size={13} className={cn(fetchingHistory && "animate-spin")} />
                Refresh
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard
              label="Health Score"
              value={healthScore.toFixed(0)}
              unit="/100"
              icon={Activity}
              color={healthScore >= 70 ? "green" : healthScore >= 40 ? "orange" : "red"}
              trend={healthScore >= 60 ? "up" : "down"}
            />
            <StatCard
              label="Test Coverage"
              value={Math.round(coverage * 100)}
              unit="%"
              icon={TrendingUp}
              color={coverage >= 0.7 ? "green" : coverage >= 0.4 ? "orange" : "red"}
            />
            <StatCard
              label="Active Agents"
              value={activeAgents}
              icon={Zap}
              color="primary"
            />
            <StatCard
              label="Bugs Found"
              value={totalBugs}
              icon={Bug}
              color={totalBugs === 0 ? "green" : totalBugs > 10 ? "red" : "orange"}
            />
            <StatCard
              label="CPU Usage"
              value={cpuUsage.toFixed(1)}
              unit="%"
              icon={Cpu}
              color={cpuUsage > 80 ? "red" : cpuUsage > 50 ? "orange" : "blue"}
            />
            <StatCard
              label="Memory"
              value={memMb.toFixed(0)}
              unit="MB"
              icon={Server}
              color="blue"
            />
            <StatCard
              label="KB Hits"
              value={kbHits}
              icon={Brain}
              color="green"
            />
            <StatCard
              label="Escalations"
              value={escalations}
              icon={Activity}
              color={escalations > 5 ? "red" : "orange"}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="glass-panel rounded-xl border border-border/50 p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-mono font-bold text-primary uppercase tracking-wider">Health Score (over time)</h2>
                <span className="text-xs font-mono text-muted-foreground">{snapshots.length} datapoints</span>
              </div>
              <div className="h-44">
                <SVGLineChart data={healthChartData} label="health" color="#00fff7" />
              </div>
            </div>

            <div className="glass-panel rounded-xl border border-border/50 p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-mono font-bold text-primary uppercase tracking-wider">Total Bugs (over time)</h2>
                <span className="text-xs font-mono text-muted-foreground">{hours}h window</span>
              </div>
              <div className="h-44">
                <SVGLineChart data={bugsChartData} label="bugs" color="#f87171" />
              </div>
            </div>

            <div className="glass-panel rounded-xl border border-border/50 p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-mono font-bold text-primary uppercase tracking-wider">Active Agents (over time)</h2>
              </div>
              <div className="h-44">
                <SVGLineChart data={agentsChartData} label="agents" color="#818cf8" />
              </div>
            </div>

            <div className="glass-panel rounded-xl border border-border/50 p-5 space-y-3">
              <h2 className="text-sm font-mono font-bold text-primary uppercase tracking-wider mb-2">City Breakdown</h2>
              {health ? (
                <div className="space-y-3">
                  {[
                    { label: "Test Coverage", value: health.testCoverageRatio, max: 1, color: "bg-green-500" },
                    { label: "Clean Buildings", value: health.cleanBuildingRatio, max: 1, color: "bg-primary" },
                    { label: "Test File Ratio", value: health.testFileRatio, max: 1, color: "bg-blue-500" },
                    {
                      label: "Complexity Score",
                      value: Math.max(0, 1 - health.avgComplexity / 30),
                      max: 1,
                      color: health.avgComplexity < 10 ? "bg-green-500" : health.avgComplexity < 20 ? "bg-orange-400" : "bg-red-500",
                    },
                  ].map(({ label, value, max, color }) => (
                    <div key={label} className="space-y-1">
                      <div className="flex justify-between text-xs font-mono text-muted-foreground">
                        <span>{label}</span>
                        <span>{Math.round((value / max) * 100)}%</span>
                      </div>
                      <div className="h-2 bg-muted/40 rounded-full overflow-hidden">
                        <div
                          className={cn("h-full rounded-full transition-all duration-500", color)}
                          style={{ width: `${Math.min(100, Math.round((value / max) * 100))}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-muted-foreground text-sm font-mono">Loading city health…</div>
              )}
            </div>
          </div>

          <div className="glass-panel rounded-xl border border-border/50 p-5 space-y-3">
            <h2 className="text-sm font-mono font-bold text-primary uppercase tracking-wider">Knowledge Search</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm font-mono">
              <div className="rounded-lg border border-border/40 bg-background/40 p-3">
                <div className="text-muted-foreground">Vector search</div>
                <div className="mt-1 text-foreground">{vectorCacheSize} entries indexed</div>
              </div>
              <div className="rounded-lg border border-border/40 bg-background/40 p-3">
                <div className="text-muted-foreground">Model status</div>
                <div className={cn("mt-1", modelLoaded ? "text-green-400" : "text-orange-400")}>
                  {modelLoaded ? "Loaded" : "Loading"}
                </div>
              </div>
              <div className="rounded-lg border border-border/40 bg-background/40 p-3 md:col-span-2">
                <div className="text-muted-foreground">Semantic hits</div>
                <div className="mt-1 text-foreground">
                  Semantic hits: {vectorHits} | Keyword hits: {keywordHits}
                </div>
              </div>
              <div className="rounded-lg border border-border/40 bg-background/40 p-3 md:col-span-2">
                <div className="text-muted-foreground">Avg similarity</div>
                <div className="mt-1 text-foreground">{avgSimilarityPercent}%</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
