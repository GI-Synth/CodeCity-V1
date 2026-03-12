import { useState, useEffect, useRef } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { CityMap } from "@/components/city/CityMap";
import { BuildingInspector } from "@/components/city/BuildingInspector";
import { HUD } from "@/components/city/HUD";
import { useGetCityLayout, useGetCityHealth, useGetLiveMetrics, useListAgents } from "@workspace/api-client-react";
import { Loader2, Cpu, MemoryStick, Activity, Zap, Brain, X } from "lucide-react";
import { cn } from "@/lib/utils";

function DebugHUD({ metrics, agents, visible }: { metrics: any; agents: any[]; visible: boolean }) {
  const [fps, setFps] = useState(60);
  const frameCount = useRef(0);
  const lastTime = useRef(performance.now());

  useEffect(() => {
    let raf: number;
    const tick = () => {
      frameCount.current++;
      const now = performance.now();
      if (now - lastTime.current >= 1000) {
        setFps(Math.round(frameCount.current * 1000 / (now - lastTime.current)));
        frameCount.current = 0;
        lastTime.current = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  if (!visible) return null;

  const activeAgents = agents.filter(a => a.status === 'working').length;
  const escalatingAgents = agents.filter(a => a.status === 'escalating').length;

  return (
    <div className="absolute top-20 right-4 z-30 glass-panel border border-yellow-400/40 rounded-xl p-4 w-56 text-xs font-mono space-y-3">
      <div className="flex items-center justify-between border-b border-yellow-400/20 pb-2">
        <span className="text-yellow-400 font-bold uppercase tracking-widest text-[10px]">Debug HUD [F3]</span>
      </div>

      <DebugRow label="FPS" value={fps.toString()} color={fps >= 55 ? "text-success" : fps >= 30 ? "text-warning" : "text-destructive"} icon={Zap} />
      <DebugRow label="CPU" value={metrics ? `${metrics.cpuUsage?.toFixed(1)}%` : "—"} color="text-orange-400" icon={Cpu} />
      <DebugRow label="RAM" value={metrics ? `${metrics.memoryUsage?.toFixed(0)} MB` : "—"} color="text-blue-400" icon={MemoryStick} />
      <DebugRow label="Active Agents" value={activeAgents.toString()} color="text-primary" icon={Activity} />
      <DebugRow label="Escalating" value={escalatingAgents.toString()} color={escalatingAgents > 0 ? "text-warning" : "text-muted-foreground"} icon={Brain} />
      <DebugRow label="Bugs Found" value={metrics?.bugsFound?.toString() ?? "—"} color="text-destructive" icon={Zap} />

      <div className="border-t border-yellow-400/20 pt-2 text-[10px] text-muted-foreground">
        Press <kbd className="px-1 py-0.5 bg-black/40 border border-border rounded text-yellow-400">F3</kbd> to toggle
      </div>
    </div>
  );
}

function DebugRow({ label, value, color, icon: Icon }: { label: string; value: string; color: string; icon: any }) {
  return (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <Icon size={11} />
        {label}
      </span>
      <span className={cn("font-bold", color)}>{value}</span>
    </div>
  );
}

export function CityView() {
  const [selectedBuildingId, setSelectedBuildingId] = useState<string | null>(null);
  const [debugVisible, setDebugVisible] = useState(false);

  const { data: layout, isLoading: layoutLoading } = useGetCityLayout({ query: { refetchInterval: 5000 } });
  const { data: health } = useGetCityHealth({ query: { refetchInterval: 5000 } });
  const { data: metrics } = useGetLiveMetrics({ query: { refetchInterval: 2000 } });
  const { data: agentsData } = useListAgents({ query: { refetchInterval: 2000 } });

  const agents = agentsData?.agents || [];

  const selectedBuilding = layout?.districts
    ?.flatMap(d => d.buildings)
    .find(b => b.id === selectedBuildingId);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F3') {
        e.preventDefault();
        setDebugVisible(v => !v);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  if (layoutLoading) {
    return (
      <AppLayout>
        <div className="flex-1 flex flex-col items-center justify-center bg-background text-primary font-mono">
          <Loader2 size={48} className="animate-spin mb-4" />
          <div className="text-glow mb-2">INITIALIZING CITY GRID...</div>
          <div className="text-xs text-muted-foreground animate-pulse">Loading districts, buildings, and agents</div>
          <div className="mt-6 w-64 h-1.5 bg-black/60 rounded-full overflow-hidden">
            <div className="h-full bg-primary rounded-full animate-[loading_1.5s_ease-in-out_infinite]" style={{ width: '60%' }} />
          </div>
        </div>
      </AppLayout>
    );
  }

  if (!layout) {
    return (
      <AppLayout>
        <div className="flex-1 flex items-center justify-center bg-background text-destructive font-mono">
          FAILED TO LOAD CITY LAYOUT
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="relative w-full h-full flex">
        <div className="flex-1 relative">
          <HUD health={health} metrics={metrics} />
          <DebugHUD metrics={metrics} agents={agents} visible={debugVisible} />

          <CityMap
            layout={layout}
            agents={agents}
            selectedBuildingId={selectedBuildingId}
            onSelectBuilding={setSelectedBuildingId}
          />

          {/* F3 hint */}
          {!debugVisible && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-[10px] font-mono text-muted-foreground/40 pointer-events-none select-none">
              Press F3 for debug metrics
            </div>
          )}
        </div>

        {selectedBuilding && (
          <BuildingInspector
            building={selectedBuilding}
            onClose={() => setSelectedBuildingId(null)}
          />
        )}
      </div>
    </AppLayout>
  );
}
