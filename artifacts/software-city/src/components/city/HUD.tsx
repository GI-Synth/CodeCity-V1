import { CityHealth, LiveMetrics } from "@workspace/api-client-react";
import { Activity, ShieldAlert, Cpu, Database, Thermometer, CloudSnow, Sun, Leaf, Wifi, WifiOff, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";

interface HUDProps {
  health?: CityHealth;
  metrics?: LiveMetrics;
  wsConnected?: boolean;
  ollamaAvailable?: boolean;
}

export function HUD({ health, metrics, wsConnected, ollamaAvailable }: HUDProps) {
  const prevScore = useRef<number | null>(null);
  const [trend, setTrend] = useState<"up" | "down" | "flat">("flat");

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

  if (!health || !metrics) return null;

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
              "text-2xl font-black font-mono text-glow",
              health.score > 80 ? "text-success" : health.score > 50 ? "text-warning" : "text-destructive"
            )}>
              {health.score}
            </span>
            <span className="text-muted-foreground text-sm">/100</span>
            {trend === "up" && <TrendingUp size={14} className="text-success" />}
            {trend === "down" && <TrendingDown size={14} className="text-destructive" />}
            {trend === "flat" && <Minus size={14} className="text-muted-foreground" />}
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
