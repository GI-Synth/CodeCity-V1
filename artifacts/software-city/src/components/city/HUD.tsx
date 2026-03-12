import { CityHealth, LiveMetrics } from "@workspace/api-client-react";
import { Activity, ShieldAlert, Cpu, Database, Thermometer, CloudSnow, Sun, Leaf } from "lucide-react";
import { cn } from "@/lib/utils";

export function HUD({ health, metrics }: { health?: CityHealth, metrics?: LiveMetrics }) {
  if (!health || !metrics) return null;

  const getSeasonIcon = (season: string) => {
    switch(season) {
      case 'summer': return <Sun className="text-warning" />;
      case 'winter': return <CloudSnow className="text-primary" />;
      case 'spring': return <Leaf className="text-success" />;
      case 'autumn': return <Leaf className="text-orange-500" />;
      default: return <Thermometer />;
    }
  };

  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 flex gap-4 z-20">
      
      {/* City Health Score */}
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
          </div>
        </div>

        <div className="flex flex-col items-start pl-2">
          <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">Season</span>
          <div className="flex items-center gap-2 font-mono text-sm capitalize text-foreground">
            {getSeasonIcon(health.season)} {health.season}
          </div>
        </div>
      </div>

      {/* Live Metrics */}
      <div className="glass-panel px-4 py-2 rounded-xl flex items-center gap-6">
        <MetricItem icon={Activity} label="Active Agents" value={metrics.activeAgents} color="text-primary" />
        <MetricItem icon={ShieldAlert} label="Bugs Found" value={metrics.bugsFound} color="text-destructive" />
        <MetricItem icon={Cpu} label="CPU Load" value={`${metrics.cpuUsage}%`} color="text-warning" />
      </div>

    </div>
  );
}

function MetricItem({ icon: Icon, label, value, color }: any) {
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
