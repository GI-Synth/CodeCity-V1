import { useState, useEffect, useRef, Component, useCallback } from "react";
import type { ReactNode, ErrorInfo } from "react";
import { useLocation } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { CityMap } from "@/components/city/CityMap";
import { BuildingInspector } from "@/components/city/BuildingInspector";
import { HUD } from "@/components/city/HUD";
import { GuidedTour, useTour } from "@/components/GuidedTour";
import { ShortcutsPanel } from "@/components/ShortcutsPanel";
import { useGetCityLayout, useGetCityHealth, useGetLiveMetrics, useListAgents } from "@workspace/api-client-react";
import type { Agent } from "@workspace/api-client-react";
import { Loader2, Cpu, MemoryStick, Activity, Zap, Brain, Download, Share2, Check, Keyboard, MapPin, FileText, ChevronDown, ImageDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWebSocket } from "@/hooks/useWebSocket";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

class CityMapErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; error?: Error }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[CityMap] Error boundary caught:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center bg-background text-destructive font-mono p-8">
          <div className="text-2xl font-bold mb-4">⚠ City Renderer Crashed</div>
          <div className="text-sm text-muted-foreground mb-2 max-w-md text-center">
            {this.state.error?.message ?? "An unexpected error occurred in the city map."}
          </div>
          <button
            onClick={() => this.setState({ hasError: false })}
            className="mt-4 px-4 py-2 rounded border border-destructive text-destructive hover:bg-destructive/10 text-sm font-mono"
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function DebugHUD({ metrics, agents, visible, visibleBuildings, totalBuildings }: {
  metrics: any;
  agents: Agent[];
  visible: boolean;
  visibleBuildings?: number;
  totalBuildings?: number;
}) {
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

  const activeAgents = agents.filter(a => a.status === "working").length;
  const escalatingAgents = agents.filter(a => a.status === "escalating").length;

  return (
    <div className="absolute top-20 right-4 z-30 glass-panel border border-yellow-400/40 rounded-xl p-4 w-56 text-xs font-mono space-y-3">
      <div className="flex items-center justify-between border-b border-yellow-400/20 pb-2">
        <span className="text-yellow-400 font-bold uppercase tracking-widest text-[10px]">Debug HUD [F3]</span>
      </div>
      <DebugRow label="FPS" value={fps.toString()} color={fps >= 55 ? "text-success" : fps >= 30 ? "text-warning" : "text-destructive"} icon={Zap} />
      <DebugRow label="CPU" value={metrics ? `${(metrics.cpuUsage ?? 0).toFixed(1)}%` : "—"} color="text-orange-400" icon={Cpu} />
      <DebugRow label="RAM" value={metrics ? `${(metrics.memoryUsage ?? 0).toFixed(0)} MB` : "—"} color="text-blue-400" icon={MemoryStick} />
      <DebugRow label="Active Agents" value={activeAgents.toString()} color="text-primary" icon={Activity} />
      <DebugRow label="Escalating" value={escalatingAgents.toString()} color={escalatingAgents > 0 ? "text-warning" : "text-muted-foreground"} icon={Brain} />
      <DebugRow label="Bugs Found" value={metrics?.bugsFound?.toString() ?? "—"} color="text-destructive" icon={Zap} />
      {visibleBuildings !== undefined && totalBuildings !== undefined && (
        <DebugRow
          label="Rendering"
          value={`${visibleBuildings}/${totalBuildings}`}
          color={visibleBuildings === totalBuildings ? "text-muted-foreground" : "text-primary"}
          icon={MapPin}
        />
      )}
      <div className="border-t border-yellow-400/20 pt-2 text-[10px] text-muted-foreground">
        Press <kbd className="px-1 py-0.5 bg-black/40 border border-border rounded text-yellow-400">F3</kbd> to toggle
      </div>
    </div>
  );
}

function DebugRow({ label, value, color, icon: Icon }: { label: string; value: string; color: string; icon: any }) {
  return (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-1.5 text-muted-foreground"><Icon size={11} />{label}</span>
      <span className={cn("font-bold", color)}>{value}</span>
    </div>
  );
}

export function CityView() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [selectedBuildingId, setSelectedBuildingId] = useState<string | null>(null);
  const [debugVisible, setDebugVisible] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [wsAgentOverrides, setWsAgentOverrides] = useState<Map<string, { x: number; y: number }>>(new Map());
  const [flashedBuildings, setFlashedBuildings] = useState<Set<string>>(new Set());
  const [npcThoughts, setNpcThoughts] = useState<Map<string, string>>(new Map());
  const [sharing, setSharing] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState<number | undefined>(undefined);
  const [totalCount, setTotalCount] = useState<number | undefined>(undefined);
  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

  const { data: layout, isLoading: layoutLoading } = useGetCityLayout({ query: { refetchInterval: 10000 } });
  const { data: health, refetch: refetchHealth } = useGetCityHealth({ query: { refetchInterval: 10000 } });
  const { data: metrics } = useGetLiveMetrics({ query: { refetchInterval: 3000 } });
  const { data: agentsData, refetch: refetchAgents } = useListAgents({ query: { refetchInterval: 5000 } });

  const { connected: wsConnected, lastMessage } = useWebSocket();
  const { showTour, startTour, endTour } = useTour();

  const agents: Agent[] = (agentsData?.agents ?? []).map(a => {
    const override = wsAgentOverrides.get(a.id);
    if (override) return { ...a, x: override.x, y: override.y };
    return a;
  });

  useEffect(() => {
    if (!lastMessage) return;
    const { type, payload } = lastMessage;

    if (type === "npc_move") {
      const { npcId, x, y } = payload as { npcId: string; x: number; y: number };
      setWsAgentOverrides(prev => new Map(prev).set(npcId, { x, y }));
    } else if (type === "npc_thought") {
      const { npcId, thought, duration } = payload as { npcId: string; thought: string; duration: number };
      setNpcThoughts(prev => new Map(prev).set(npcId, thought));
      setTimeout(() => {
        setNpcThoughts(prev => {
          const next = new Map(prev);
          next.delete(npcId);
          return next;
        });
      }, duration ?? 4000);
    } else if (type === "bug_found") {
      const { buildingId } = payload as { buildingId: string };
      setFlashedBuildings(prev => new Set(prev).add(buildingId));
      setTimeout(() => setFlashedBuildings(prev => {
        const next = new Set(prev);
        next.delete(buildingId);
        return next;
      }), 1500);
    } else if (type === "season_change") {
      refetchHealth();
    } else if (type === "task_complete") {
      refetchAgents();
    }
  }, [lastMessage]);

  const handleShare = useCallback(async () => {
    setSharing(true);
    try {
      const res = await fetch("/api/city/share", { method: "POST" });
      const data = await res.json() as { url?: string; token?: string };
      if (data.url) {
        const fullUrl = `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, "")}${data.url}`;
        setShareUrl(fullUrl);
        await navigator.clipboard.writeText(fullUrl).catch(() => {});
        toast({ title: "Share link copied!", description: "City snapshot link copied to clipboard." });
      }
    } catch {
      toast({ title: "Share failed", variant: "destructive" });
    } finally {
      setSharing(false);
    }
  }, [toast]);

  const [ollamaAvailable, setOllamaAvailable] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    fetch("/api/ollama/status")
      .then(r => r.json())
      .then((d: any) => setOllamaAvailable(d.available))
      .catch(() => setOllamaAvailable(false));
  }, []);

  const selectedBuilding = layout?.districts
    ?.flatMap(d => d.buildings)
    .find(b => b.id === selectedBuildingId);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea") return;

      if (e.key === "F3") { e.preventDefault(); setDebugVisible(v => !v); }
      else if (e.key === "?") { e.preventDefault(); setShortcutsOpen(v => !v); }
      else if (e.key === "Escape") {
        if (shortcutsOpen) { setShortcutsOpen(false); return; }
        if (showTour) { endTour(); return; }
        setSelectedBuildingId(null);
      }
      else if (e.key === "t" || e.key === "T") { startTour(); }
      else if (e.key === "k" || e.key === "K") { setLocation("/knowledge"); }
      else if (e.key === "a" || e.key === "A") { setLocation("/agents"); }
      else if (e.key === "g" || e.key === "G") { setLocation("/city"); }
      else if (e.key === "l" || e.key === "L") { setLocation("/leaderboard"); }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [shortcutsOpen, showTour, endTour, startTour, setLocation]);

  const handleExportJSON = () => {
    const link = document.createElement("a");
    link.href = "/api/city/snapshot";
    link.download = `software-city-${Date.now()}.json`;
    link.click();
    setExportOpen(false);
  };

  const handleExportSVG = () => {
    const svg = document.querySelector("[data-city-map]") as SVGSVGElement | null;
    if (!svg) return;
    const serializer = new XMLSerializer();
    const svgStr = serializer.serializeToString(svg);
    const blob = new Blob([svgStr], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `software-city-map-${Date.now()}.svg`;
    link.click();
    URL.revokeObjectURL(url);
    setExportOpen(false);
  };

  const handleExportReport = async () => {
    setExportOpen(false);
    try {
      const res = await fetch("/api/city/report", { method: "POST" });
      const data = await res.json() as { report?: string };
      if (!data.report) throw new Error("No report");
      const blob = new Blob([data.report], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `software-city-report-${Date.now()}.md`;
      link.click();
      URL.revokeObjectURL(url);
      toast({ title: "Report exported!", description: "Markdown report downloaded." });
    } catch {
      toast({ title: "Export failed", variant: "destructive" });
    }
  };

  useEffect(() => {
    if (!exportOpen) return;
    const handle = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
        setExportOpen(false);
      }
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [exportOpen]);

  if (layoutLoading) {
    return (
      <AppLayout>
        <div className="flex-1 flex flex-col items-center justify-center bg-background text-primary font-mono">
          <Loader2 size={48} className="animate-spin mb-4" />
          <div className="text-glow mb-2">INITIALIZING CITY GRID...</div>
          <div className="text-xs text-muted-foreground animate-pulse">Loading districts, buildings, and agents</div>
          <div className="mt-6 w-64 h-1.5 bg-black/60 rounded-full overflow-hidden">
            <div className="h-full bg-primary rounded-full animate-[loading_1.5s_ease-in-out_infinite]" style={{ width: "60%" }} />
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
        <div className="flex-1 relative" data-tour="city-map">
          <div data-tour="hud">
            <HUD health={health} metrics={metrics} wsConnected={wsConnected} ollamaAvailable={ollamaAvailable} />
          </div>
          <DebugHUD
            metrics={metrics}
            agents={agents}
            visible={debugVisible}
            visibleBuildings={visibleCount}
            totalBuildings={totalCount}
          />

          <div className="absolute top-4 right-4 z-20 flex gap-2" data-tour="share-btn">
            <div ref={exportRef} className="relative">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setExportOpen(v => !v)}
                className="h-8 text-xs font-mono border-primary/30"
              >
                <Download size={12} className="mr-1.5" /> Export <ChevronDown size={10} className="ml-1" />
              </Button>
              {exportOpen && (
                <div className="absolute right-0 top-9 z-50 w-44 rounded-md border border-primary/30 bg-background/95 backdrop-blur shadow-neon overflow-hidden">
                  <button
                    className="flex w-full items-center gap-2 px-3 py-2 text-xs font-mono hover:bg-primary/10 text-left"
                    onClick={handleExportJSON}
                  >
                    <Download size={12} /> JSON Snapshot
                  </button>
                  <button
                    className="flex w-full items-center gap-2 px-3 py-2 text-xs font-mono hover:bg-primary/10 text-left"
                    onClick={handleExportSVG}
                  >
                    <ImageDown size={12} /> SVG Map
                  </button>
                  <button
                    className="flex w-full items-center gap-2 px-3 py-2 text-xs font-mono hover:bg-primary/10 text-left"
                    onClick={handleExportReport}
                  >
                    <FileText size={12} /> Markdown Report
                  </button>
                </div>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleShare}
              disabled={sharing}
              className={cn("h-8 text-xs font-mono", shareUrl ? "border-green-400/50 text-green-400" : "border-primary/30")}
            >
              {shareUrl ? <Check size={12} className="mr-1.5" /> : <Share2 size={12} className="mr-1.5" />}
              {sharing ? "Sharing…" : shareUrl ? "Copied!" : "Share"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShortcutsOpen(true)}
              className="h-8 text-xs font-mono border-primary/30"
              title="Keyboard shortcuts (?)"
            >
              <Keyboard size={12} />
            </Button>
          </div>

          <CityMapErrorBoundary>
            <CityMap
              layout={layout}
              agents={agents}
              selectedBuildingId={selectedBuildingId}
              onSelectBuilding={setSelectedBuildingId}
              flashedBuildings={flashedBuildings}
              npcThoughts={npcThoughts}
              onVisibleCountChange={(visible, total) => { setVisibleCount(visible); setTotalCount(total); }}
            />
          </CityMapErrorBoundary>

          {!debugVisible && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-[10px] font-mono text-muted-foreground/40 pointer-events-none select-none">
              Press F3 for debug metrics · ? for shortcuts · T for tour
            </div>
          )}
        </div>

        {selectedBuilding && (
          <BuildingInspector
            building={selectedBuilding}
            agents={agents}
            onClose={() => setSelectedBuildingId(null)}
          />
        )}
      </div>

      <ShortcutsPanel open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      {showTour && <GuidedTour onDone={endTour} />}
    </AppLayout>
  );
}
