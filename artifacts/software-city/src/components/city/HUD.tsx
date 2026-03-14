import { CityHealth, LiveMetrics } from "@workspace/api-client-react";
import { Activity, ShieldAlert, Cpu, Database, Thermometer, CloudSnow, Sun, Leaf, Wifi, WifiOff, TrendingUp, TrendingDown, Minus, FlaskConical } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";

interface HUDProps {
  health?: CityHealth;
  metrics?: LiveMetrics;
  wsConnected?: boolean;
  ollamaAvailable?: boolean;
}

interface OrchestratorStatus {
  lastDirective?: {
    reasoning?: string;
  } | null;
  model?: string;
}

interface KbSessionStats {
  kbHits: number;
  kbMisses: number;
  kbHitRate: number;
}

interface AlchemistSummary {
  totalRuns: number;
  success: number;
  failed: number;
  blocked: number;
  timeout: number;
  successRate: number;
  lastRun?: {
    status?: string;
  } | null;
}

function truncateText(text: string, max = 80): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}...`;
}

export function HUD({ health, metrics, wsConnected, ollamaAvailable }: HUDProps) {
  const prevScore = useRef<number | null>(null);
  const prevReasoning = useRef<string>("");
  const [trend, setTrend] = useState<"up" | "down" | "flat">("flat");
  const [orchestratorStatus, setOrchestratorStatus] = useState<OrchestratorStatus | null>(null);
  const [kbSessionStats, setKbSessionStats] = useState<KbSessionStats | null>(null);
  const [alchemistSummary, setAlchemistSummary] = useState<AlchemistSummary | null>(null);
  const [mayorFlash, setMayorFlash] = useState(false);

  useEffect(() => {
    let mounted = true;
    let timer: ReturnType<typeof setInterval> | null = null;

    const fetchStatus = async () => {
      try {
        const res = await fetch("/api/orchestrator/status", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json() as OrchestratorStatus;
        if (!mounted) return;

        const newReasoning = data.lastDirective?.reasoning ?? "";
        if (newReasoning && prevReasoning.current && prevReasoning.current !== newReasoning) {
          setMayorFlash(true);
          setTimeout(() => setMayorFlash(false), 200);
        }
        prevReasoning.current = newReasoning;
        setOrchestratorStatus(data);
      } catch {
        // Ignore polling errors and keep last known status.
      }
    };

    fetchStatus().catch(() => {});
    timer = setInterval(() => {
      fetchStatus().catch(() => {});
    }, 15000);

    return () => {
      mounted = false;
      if (timer) clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    let timer: ReturnType<typeof setInterval> | null = null;

    const fetchAlchemistSummary = async () => {
      try {
        const res = await fetch("/api/alchemist/summary", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json() as AlchemistSummary;
        if (!mounted) return;
        setAlchemistSummary(data);
      } catch {
        // Keep last known summary if polling fails.
      }
    };

    fetchAlchemistSummary().catch(() => {});
    timer = setInterval(() => {
      fetchAlchemistSummary().catch(() => {});
    }, 6000);

    return () => {
      mounted = false;
      if (timer) clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!health) return;
    if (prevScore.current === null) {
      prevScore.current = health.score;
      return;
    }
    const diff = health.score - prevScore.current;
    if (diff >= 2) setTrend("up");
    else if (diff <= -2) setTrend("down");
    else setTrend("flat");
    prevScore.current = health.score;
  }, [health?.score]);

  useEffect(() => {
    let mounted = true;
    let timer: ReturnType<typeof setInterval> | null = null;

    const fetchKbSessionStats = async () => {
      try {
        const res = await fetch("/api/knowledge/session-stats", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json() as KbSessionStats;
        if (!mounted) return;
        setKbSessionStats(data);
      } catch {
        // Ignore polling errors and keep last known stats.
      }
    };

    fetchKbSessionStats().catch(() => {});
    timer = setInterval(() => {
      fetchKbSessionStats().catch(() => {});
    }, 4000);

    return () => {
      mounted = false;
      if (timer) clearInterval(timer);
    };
  }, []);

  if (!health || !metrics) return null;

  const mayorReasoning = truncateText(orchestratorStatus?.lastDirective?.reasoning ?? "Mayor thinking...");
  const mayorModel = orchestratorStatus?.model ?? "rule-based";
  const kbHitRatePercent = Math.round((kbSessionStats?.kbHitRate ?? 0) * 100);
  const alchemistSuccessRate = Math.round((alchemistSummary?.successRate ?? 0) * 100);
  const alchemistStatus = alchemistSummary?.lastRun?.status ?? "idle";
  const healthColor =
    health.score > 70
      ? "#00ff88"
      : health.score >= 40
        ? "#ffcc00"
        : health.score >= 20
          ? "#ff8800"
          : "#ff3b3b";
  const isCriticalHealth = health.score < 20;

  const getSeasonIcon = (season: string) => {
    switch (season) {
      case "summer": return <Sun className="text-yellow-400 animate-pulse" size={16} />;
      case "winter": return <CloudSnow className="text-blue-300 animate-bounce" size={16} />;
      case "spring": return <Leaf className="text-green-400 animate-bounce" size={16} />;
      case "autumn": return <Leaf className="text-orange-400 animate-spin" size={16} style={{ animationDuration: "4s" }} />;
      default: return <Thermometer size={16} />;
    }
  };

  const cpuDisplay = typeof metrics.cpuUsage === "number" ? `${metrics.cpuUsage.toFixed(1)}%` : "—";

  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 flex gap-4 z-20">
      <div className="glass-panel px-6 py-3 rounded-full flex items-center gap-4 border-primary/40 shadow-neon">
        <div className="flex flex-col items-end border-r border-border/50 pr-4">
          <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">Health Score</span>
          <div className="flex items-center gap-2">
            <span className={cn(
              "text-2xl font-black font-mono transition-[color,text-shadow,opacity] duration-700",
              isCriticalHealth ? "hud-health-critical" : ""
            )}
            style={{
              color: healthColor,
              textShadow: `0 0 10px ${healthColor}66`,
            }}>
              {health.score}
            </span>
            <span className="text-muted-foreground text-sm">/100</span>
            {trend === "up" && <TrendingUp size={14} className="text-success" />}
            {trend === "down" && <TrendingDown size={14} className="text-destructive" />}
            {trend === "flat" && <Minus size={14} className="text-muted-foreground" />}
          </div>
          <div className={cn(
            "mayor-panel mt-1 max-w-[300px] rounded px-1.5 py-1 text-[10px] font-mono text-muted-foreground/80 flex items-center gap-1.5",
            mayorFlash ? "bg-cyan-400/20" : "bg-transparent"
          )}>
            <span>🏛</span>
            <span className="truncate">{mayorReasoning}</span>
            <span className="mayor-model ml-1 uppercase text-[9px] text-muted-foreground/60">{mayorModel}</span>
          </div>
        </div>

        <div className="flex flex-col items-start pl-2">
          <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">Season</span>
          <div className="flex items-center gap-2 font-mono text-sm capitalize text-foreground">
            {getSeasonIcon(health.season)} {health.season}
          </div>
        </div>
      </div>

      <div className="glass-panel px-4 py-2 rounded-xl flex items-center gap-6">
        <MetricItem icon={Activity} label="Active Agents" value={metrics.activeAgents?.toString() ?? "—"} color="text-primary" />
        <MetricItem icon={ShieldAlert} label="Bugs Found" value={metrics.bugsFound?.toString() ?? "—"} color="text-destructive" />
        <MetricItem icon={Database} label="KB Hit Rate" value={kbSessionStats ? `${kbHitRatePercent}%` : "—"} color="text-secondary" />
        <MetricItem
          icon={FlaskConical}
          label="Alchemy"
          value={alchemistSummary ? `${alchemistSuccessRate}% (${alchemistStatus})` : "—"}
          color={alchemistStatus === "success" ? "text-success" : alchemistStatus === "idle" ? "text-muted-foreground" : "text-warning"}
        />
        <MetricItem icon={Cpu} label="CPU Load" value={cpuDisplay} color="text-warning" />
        <div className="flex items-center gap-2 pl-2 border-l border-border/40">
          <div className={cn("flex items-center gap-1.5 text-xs font-mono", wsConnected ? "text-success" : "text-muted-foreground")}>
            {wsConnected ? <Wifi size={12} /> : <WifiOff size={12} />}
            <span className="hidden sm:block">{wsConnected ? "LIVE" : "POLL"}</span>
          </div>
          {ollamaAvailable !== undefined && (
            <div className={cn("w-2 h-2 rounded-full", ollamaAvailable ? "bg-success animate-pulse" : "bg-muted-foreground")}
              title={ollamaAvailable ? "Ollama AI available" : "Ollama not available"} />
          )}
        </div>
      </div>
    </div>
  );
}

function MetricItem({ icon: Icon, label, value, color }: { icon: any; label: string; value: string; color: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className={cn("p-1.5 rounded bg-background/50", color)}>
        <Icon size={16} />
      </div>
      <div className="flex flex-col">
        <span className="text-[9px] font-mono text-muted-foreground uppercase">{label}</span>
        <span className="font-mono text-sm font-bold text-foreground">{value}</span>
      </div>
    </div>
  );
}
