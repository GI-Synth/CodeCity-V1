import { useQuery } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { cn } from "@/lib/utils";
import { Activity, Bug, Brain, Zap, RefreshCw, TrendingUp, TrendingDown, Cpu, Server, type LucideIcon } from "lucide-react";
import { format } from "date-fns";
import { useState } from "react";

interface MetricSnapshot {
  id: number;
  timestamp: string;
  healthScore: number;
  coverageOverall: number;
  predictionAccuracyScore: number;
  falseNegativeRate: number;
  confidenceCalibrationIndex: number;
  recommendationFixConversion: number;
  testGenerationEffectiveness: number;
  kpiSampleSize: number;
  reinforcementAttempts: number;
  reinforcementApplied: number;
  reinforcementBoosts: number;
  reinforcementDecays: number;
  reinforcementNet: number;
  reinforcementCoverage: number;
  agingPersonalUpdates: number;
  agingKnowledgeUpdates: number;
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
  kpiContractVersion?: string;
}

interface ReinforcementSummary {
  hours: number;
  since: string;
  totals: {
    attempts: number;
    applied: number;
    boosts: number;
    decays: number;
    net: number;
    coverage: number;
  };
  topBoostPatterns: Array<{ issuePattern: string; count: number }>;
  topDecayPatterns: Array<{ issuePattern: string; count: number }>;
  topAgentDeltas: Array<{ agentName: string; agentId: string | null; boosts: number; decays: number; net: number }>;
  trend: Array<{ bucket: string; boosts: number; decays: number; net: number }>;
  smarterPercentEstimate: number;
  smarterPercentComponents: {
    pasDelta: number;
    fnrDelta: number;
    cciDelta: number;
    coverageLift: number;
  } | null;
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
  icon: LucideIcon;
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

  function kpiTrend(current: number, previous: number | undefined, invert = false): "up" | "down" | "neutral" {
    if (typeof previous !== "number") return "neutral";
    const delta = current - previous;
    if (Math.abs(delta) < 0.0025) return "neutral";
    if (invert) return delta < 0 ? "up" : "down";
    return delta > 0 ? "up" : "down";
  }

  const { data: history, refetch: refetchHistory, isFetching: fetchingHistory } = useQuery<MetricsHistory>({
    queryKey: ["metricsHistory", hours],
    queryFn: async () => {
      const res = await fetch(`/api/metrics/history?hours=${hours}`);
      if (!res.ok) throw new Error("Failed to fetch metrics history");
      return res.json() as Promise<MetricsHistory>;
    },
    refetchInterval: 30_000,
  });

  const {
    data: reinforcementSummary,
    refetch: refetchReinforcement,
    isFetching: fetchingReinforcement,
  } = useQuery<ReinforcementSummary>({
    queryKey: ["reinforcementSummary", hours],
    queryFn: async () => {
      const res = await fetch(`/api/metrics/reinforcement-summary?hours=${hours}`);
      if (!res.ok) throw new Error("Failed to fetch reinforcement summary");
      return res.json() as Promise<ReinforcementSummary>;
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
  const pasChartData = snapshots.map(s => ({ time: s.timestamp, value: (s.predictionAccuracyScore ?? 0) * 100 }));
  const fnrChartData = snapshots.map(s => ({ time: s.timestamp, value: (s.falseNegativeRate ?? 0) * 100 }));
  const reinforcementTrendData = (reinforcementSummary?.trend ?? []).map(s => ({ time: s.bucket, value: s.net }));

  const lastSnap = snapshots[snapshots.length - 1];
  const prevSnap = snapshots.length > 1 ? snapshots[snapshots.length - 2] : undefined;
  const kpiContractVersion = history?.kpiContractVersion ?? "phase1-v1";
  const healthScore = health?.score ?? lastSnap?.healthScore ?? 0;
  const coverage = health?.testCoverageRatio ?? lastSnap?.coverageOverall ?? 0;
  const pas = Math.max(0, Math.min(1, lastSnap?.predictionAccuracyScore ?? 0));
  const fnr = Math.max(0, Math.min(1, lastSnap?.falseNegativeRate ?? 0));
  const cci = Math.max(0, Math.min(1, lastSnap?.confidenceCalibrationIndex ?? 0));
  const rfc = Math.max(0, Math.min(1, lastSnap?.recommendationFixConversion ?? 0));
  const tge = Math.max(0, Math.min(1, lastSnap?.testGenerationEffectiveness ?? 0));
  const reinforcementCoverage = Math.max(0, Math.min(1, reinforcementSummary?.totals.coverage ?? lastSnap?.reinforcementCoverage ?? 0));
  const reinforcementNet = reinforcementSummary?.totals.net ?? lastSnap?.reinforcementNet ?? 0;
  const reinforcementBoosts = reinforcementSummary?.totals.boosts ?? lastSnap?.reinforcementBoosts ?? 0;
  const reinforcementDecays = reinforcementSummary?.totals.decays ?? lastSnap?.reinforcementDecays ?? 0;
  const smarterPercentEstimate = reinforcementSummary?.smarterPercentEstimate ?? 0;
  const kpiSampleSize = lastSnap?.kpiSampleSize ?? 0;
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
  const topBoostPatterns = reinforcementSummary?.topBoostPatterns ?? [];
  const topDecayPatterns = reinforcementSummary?.topDecayPatterns ?? [];
  const topAgentDeltas = reinforcementSummary?.topAgentDeltas ?? [];

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
                onClick={() => {
                  void Promise.all([refetchHistory(), refetchReinforcement()]);
                }}
                disabled={fetchingHistory || fetchingReinforcement}
                className="flex items-center gap-2 px-3 py-1.5 text-xs font-mono rounded border border-primary/30 text-primary hover:bg-primary/10 transition-colors disabled:opacity-50"
              >
                <RefreshCw size={13} className={cn((fetchingHistory || fetchingReinforcement) && "animate-spin")} />
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
            <StatCard
              label="PAS"
              value={(pas * 100).toFixed(1)}
              unit="%"
              icon={TrendingUp}
              color={pas >= 0.75 ? "green" : pas >= 0.55 ? "orange" : "red"}
              trend={kpiTrend(pas, prevSnap?.predictionAccuracyScore)}
            />
            <StatCard
              label="FNR"
              value={(fnr * 100).toFixed(1)}
              unit="%"
              icon={TrendingDown}
              color={fnr <= 0.20 ? "green" : fnr <= 0.35 ? "orange" : "red"}
              trend={kpiTrend(fnr, prevSnap?.falseNegativeRate, true)}
            />
            <StatCard
              label="CCI"
              value={(cci * 100).toFixed(1)}
              unit="%"
              icon={Activity}
              color={cci >= 0.75 ? "green" : cci >= 0.55 ? "orange" : "red"}
              trend={kpiTrend(cci, prevSnap?.confidenceCalibrationIndex)}
            />
            <StatCard
              label="RFC"
              value={(rfc * 100).toFixed(1)}
              unit="%"
              icon={RefreshCw}
              color={rfc >= 0.60 ? "green" : rfc >= 0.35 ? "orange" : "red"}
              trend={kpiTrend(rfc, prevSnap?.recommendationFixConversion)}
            />
            <StatCard
              label="TGE"
              value={(tge * 100).toFixed(1)}
              unit="%"
              icon={Zap}
              color={tge >= 0.60 ? "green" : tge >= 0.35 ? "orange" : "red"}
              trend={kpiTrend(tge, prevSnap?.testGenerationEffectiveness)}
            />
            <StatCard
              label="Reinforcement Coverage"
              value={(reinforcementCoverage * 100).toFixed(1)}
              unit="%"
              icon={Brain}
              color={reinforcementCoverage >= 0.7 ? "green" : reinforcementCoverage >= 0.45 ? "orange" : "red"}
            />
            <StatCard
              label="Smarter Estimate"
              value={smarterPercentEstimate.toFixed(1)}
              unit="%"
              icon={TrendingUp}
              color={smarterPercentEstimate >= 8 ? "green" : smarterPercentEstimate >= 0 ? "orange" : "red"}
            />
          </div>

          <div className="glass-panel rounded-xl border border-border/50 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-mono font-bold text-primary uppercase tracking-wider">Coding Genius KPIs</h2>
              <span className="text-xs font-mono text-muted-foreground">contract {kpiContractVersion} · sample {kpiSampleSize}</span>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <div className="space-y-2">
                <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider">PAS Trend (higher is better)</div>
                <div className="h-40">
                  <SVGLineChart data={pasChartData} label="pas" color="#34d399" />
                </div>
              </div>
              <div className="space-y-2">
                <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider">FNR Trend (lower is better)</div>
                <div className="h-40">
                  <SVGLineChart data={fnrChartData} label="fnr" color="#f97316" />
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3 text-xs font-mono">
              <div className="rounded-lg border border-border/40 bg-background/40 p-3">
                <div className="text-muted-foreground">PAS</div>
                <div className="mt-1 text-green-400">{(pas * 100).toFixed(1)}%</div>
              </div>
              <div className="rounded-lg border border-border/40 bg-background/40 p-3">
                <div className="text-muted-foreground">FNR</div>
                <div className="mt-1 text-orange-400">{(fnr * 100).toFixed(1)}%</div>
              </div>
              <div className="rounded-lg border border-border/40 bg-background/40 p-3">
                <div className="text-muted-foreground">CCI</div>
                <div className="mt-1 text-blue-400">{(cci * 100).toFixed(1)}%</div>
              </div>
              <div className="rounded-lg border border-border/40 bg-background/40 p-3">
                <div className="text-muted-foreground">RFC</div>
                <div className="mt-1 text-primary">{(rfc * 100).toFixed(1)}%</div>
              </div>
              <div className="rounded-lg border border-border/40 bg-background/40 p-3">
                <div className="text-muted-foreground">TGE</div>
                <div className="mt-1 text-foreground">{(tge * 100).toFixed(1)}%</div>
              </div>
            </div>
          </div>

          <div className="glass-panel rounded-xl border border-border/50 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-mono font-bold text-primary uppercase tracking-wider">Phase 2 Reinforcement</h2>
              <span className="text-xs font-mono text-muted-foreground">
                boosts {reinforcementBoosts} · decays {reinforcementDecays} · net {reinforcementNet >= 0 ? `+${reinforcementNet}` : reinforcementNet}
              </span>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <div className="space-y-2">
                <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Net reinforcement trend</div>
                <div className="h-40">
                  <SVGLineChart data={reinforcementTrendData} label="reinforcement-net" color="#f59e0b" />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs font-mono">
                <div className="rounded-lg border border-border/40 bg-background/40 p-3">
                  <div className="text-muted-foreground">Coverage</div>
                  <div className="mt-1 text-green-400">{(reinforcementCoverage * 100).toFixed(1)}%</div>
                </div>
                <div className="rounded-lg border border-border/40 bg-background/40 p-3">
                  <div className="text-muted-foreground">Smarter estimate</div>
                  <div className={cn("mt-1", smarterPercentEstimate >= 0 ? "text-primary" : "text-red-400")}>
                    {smarterPercentEstimate.toFixed(1)}%
                  </div>
                </div>
                <div className="rounded-lg border border-border/40 bg-background/40 p-3 md:col-span-2">
                  <div className="text-muted-foreground">Top boosted patterns</div>
                  <div className="mt-1 text-foreground">
                    {topBoostPatterns.length > 0
                      ? topBoostPatterns.slice(0, 5).map(pattern => `${pattern.issuePattern} (${pattern.count})`).join(" | ")
                      : "No boost pattern data yet"}
                  </div>
                </div>
                <div className="rounded-lg border border-border/40 bg-background/40 p-3 md:col-span-2">
                  <div className="text-muted-foreground">Top decayed patterns</div>
                  <div className="mt-1 text-foreground">
                    {topDecayPatterns.length > 0
                      ? topDecayPatterns.slice(0, 5).map(pattern => `${pattern.issuePattern} (${pattern.count})`).join(" | ")
                      : "No decay pattern data yet"}
                  </div>
                </div>
                <div className="rounded-lg border border-border/40 bg-background/40 p-3 md:col-span-2">
                  <div className="text-muted-foreground">Top changing agents</div>
                  <div className="mt-1 text-foreground">
                    {topAgentDeltas.length > 0
                      ? topAgentDeltas.slice(0, 5).map(agent => `${agent.agentName} (net ${agent.net >= 0 ? "+" : ""}${agent.net})`).join(" | ")
                      : "No agent reinforcement deltas yet"}
                  </div>
                </div>
              </div>
            </div>
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
