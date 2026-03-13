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
import {
  Loader2,
  Cpu,
  MemoryStick,
  Activity,
  Zap,
  Brain,
  Download,
  Share2,
  Check,
  Keyboard,
  MapPin,
  FileText,
  ChevronDown,
  ImageDown,
  Home,
  Settings2,
  RotateCcw,
  Trash2,
  UserX,
  MessageSquare,
  FileWarning,
  Copy,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useWebSocket } from "@/hooks/useWebSocket";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

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

interface MayorMessage {
  id: string;
  role: "user" | "mayor";
  text: string;
}

interface RecommendedTestFile {
  buildingId: string;
  sourceFilePath: string;
  testFilePath: string;
  whatToTest: string[];
  testType: "unit" | "integration" | "e2e";
  priority: "critical" | "high" | "medium";
}

interface GeneratedTestFile {
  testFilePath: string;
  testContent: string;
  language: string;
}

interface UrgencyReportResponse {
  report: string;
  generatedAt: string;
  summary: string;
  recommendedTestFiles: RecommendedTestFile[];
  cacheBust?: number;
}

interface SprintPlanResponse {
  plan: string;
  generatedAt: string;
  summary: string;
}

interface WeeklySummaryResponse {
  summary: string;
  generatedAt: string;
  range: string;
}

const WIPE_CONFIRMATION_TEXT = "RESET";
const MAYOR_MESSAGE_LIMIT = 24;
const MAYOR_SESSION_STORAGE_KEY = "software-city-mayor-session-id";

function getOrCreateMayorSessionId(): string {
  try {
    const existing = sessionStorage.getItem(MAYOR_SESSION_STORAGE_KEY);
    if (existing && existing.trim().length > 0) return existing;
    const created = `session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    sessionStorage.setItem(MAYOR_SESSION_STORAGE_KEY, created);
    return created;
  } catch {
    return `session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
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
  const [mayorMessages, setMayorMessages] = useState<MayorMessage[]>([]);
  const [mayorInput, setMayorInput] = useState("");
  const [sendingMayorMessage, setSendingMayorMessage] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [reportData, setReportData] = useState<UrgencyReportResponse | null>(null);
  const [sprintOpen, setSprintOpen] = useState(false);
  const [sprintLoading, setSprintLoading] = useState(false);
  const [isPlanningSprint, setIsPlanningSprint] = useState(false);
  const [sprintData, setSprintData] = useState<SprintPlanResponse | null>(null);
  const [weeklyOpen, setWeeklyOpen] = useState(false);
  const [weeklyLoading, setWeeklyLoading] = useState(false);
  const [isGeneratingWeekly, setIsGeneratingWeekly] = useState(false);
  const [weeklyData, setWeeklyData] = useState<WeeklySummaryResponse | null>(null);
  const [generatingTestFilePath, setGeneratingTestFilePath] = useState<string | null>(null);
  const [generatedTestFile, setGeneratedTestFile] = useState<GeneratedTestFile | null>(null);
  const [generatedTestOpen, setGeneratedTestOpen] = useState(false);
  const [runningControlAction, setRunningControlAction] = useState<string | null>(null);
  const mayorSessionIdRef = useRef<string>(getOrCreateMayorSessionId());
  const exportRef = useRef<HTMLDivElement>(null);
  const isGeneratingReportRef = useRef(false);

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

  const appendMayorMessage = useCallback((role: "user" | "mayor", text: string) => {
    setMayorMessages(prev => {
      const next = [...prev, { id: `mayor-${Date.now()}-${Math.random()}`, role, text }];
      return next.slice(-MAYOR_MESSAGE_LIMIT);
    });
  }, []);

  useEffect(() => {
    if (mayorMessages.length > 0) return;
    const opening = health
      ? `STATUS: Health at ${Math.round(health.score)}. Ask for guidance or request an urgency report.`
      : "STATUS: Mayor channel online. Ask for guidance or request an urgency report.";
    appendMayorMessage("mayor", opening);
  }, [health?.score, mayorMessages.length, appendMayorMessage]);

  const handleSendMayorMessage = async () => {
    const message = mayorInput.trim();
    if (!message || sendingMayorMessage) return;

    appendMayorMessage("user", message);
    setMayorInput("");
    setSendingMayorMessage(true);

    try {
      const res = await fetch("/api/orchestrator/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, sessionId: mayorSessionIdRef.current }),
      });
      const data = await res.json() as { message?: string; error?: string };
      if (!res.ok || !data.message) throw new Error(data.error ?? "Mayor chat failed");
      appendMayorMessage("mayor", data.message);
    } catch {
      appendMayorMessage("mayor", "STATUS: Chat unavailable. Continue with direct controls and request a report once API is healthy.");
      toast({ title: "Mayor chat failed", variant: "destructive" });
    } finally {
      setSendingMayorMessage(false);
    }
  };

  const handleRequestReport = async () => {
    if (isGeneratingReportRef.current || isGeneratingReport) return;

    isGeneratingReportRef.current = true;
    setIsGeneratingReport(true);
    setReportLoading(true);
    setReportOpen(true);

    try {
      const res = await fetch("/api/orchestrator/report", {
        method: "POST",
        cache: "no-store",
        headers: {
          "Cache-Control": "no-cache",
        },
      });
      const data = await res.json() as Partial<UrgencyReportResponse>;
      if (!res.ok || !data.report || !data.generatedAt || !data.summary) {
        throw new Error("Report unavailable");
      }
      const typedData: UrgencyReportResponse = {
        report: data.report,
        generatedAt: data.generatedAt,
        summary: data.summary,
        recommendedTestFiles: Array.isArray(data.recommendedTestFiles) ? data.recommendedTestFiles as RecommendedTestFile[] : [],
        cacheBust: typeof data.cacheBust === "number" ? data.cacheBust : undefined,
      };
      setReportData(typedData);
      appendMayorMessage("mayor", `${typedData.summary}\nUrgency report generated at ${typedData.generatedAt}.`);
    } catch {
      toast({ title: "Failed to generate urgency report", variant: "destructive" });
    } finally {
      setReportLoading(false);
      setIsGeneratingReport(false);
      isGeneratingReportRef.current = false;
    }
  };

  const handlePlanSprint = async () => {
    if (isPlanningSprint) return;

    setIsPlanningSprint(true);
    setSprintLoading(true);
    setSprintOpen(true);

    try {
      const res = await fetch("/api/orchestrator/sprint", {
        method: "POST",
        cache: "no-store",
        headers: {
          "Cache-Control": "no-cache",
        },
      });
      const data = await res.json() as Partial<SprintPlanResponse>;
      if (!res.ok || !data.plan || !data.generatedAt || !data.summary) {
        throw new Error("Sprint plan unavailable");
      }

      const typedData: SprintPlanResponse = {
        plan: data.plan,
        generatedAt: data.generatedAt,
        summary: data.summary,
      };

      setSprintData(typedData);
      appendMayorMessage("mayor", `${typedData.summary}\nSprint plan generated at ${typedData.generatedAt}.`);
    } catch {
      toast({ title: "Failed to build sprint plan", variant: "destructive" });
    } finally {
      setSprintLoading(false);
      setIsPlanningSprint(false);
    }
  };

  const handleCopyReport = async () => {
    if (!reportData?.report) return;
    try {
      await navigator.clipboard.writeText(reportData.report);
      toast({ title: "Report copied", description: "Urgency report copied to clipboard." });
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };

  const handleCopySprintPlan = async () => {
    if (!sprintData?.plan) return;
    try {
      await navigator.clipboard.writeText(sprintData.plan);
      toast({ title: "Sprint plan copied", description: "Sprint plan copied to clipboard." });
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };

  const handleGenerateWeeklySummary = async () => {
    if (isGeneratingWeekly) return;

    setIsGeneratingWeekly(true);
    setWeeklyLoading(true);
    setWeeklyOpen(true);

    try {
      const res = await fetch("/api/orchestrator/weekly-summary", {
        method: "POST",
        cache: "no-store",
        headers: {
          "Cache-Control": "no-cache",
        },
      });
      const data = await res.json() as Partial<WeeklySummaryResponse>;
      if (!res.ok || !data.summary || !data.generatedAt || !data.range) {
        throw new Error("Weekly summary unavailable");
      }

      const typedData: WeeklySummaryResponse = {
        summary: data.summary,
        generatedAt: data.generatedAt,
        range: data.range,
      };

      setWeeklyData(typedData);
      appendMayorMessage("mayor", `Weekly summary generated for ${typedData.range} at ${typedData.generatedAt}.`);
    } catch {
      toast({ title: "Failed to generate weekly summary", variant: "destructive" });
    } finally {
      setWeeklyLoading(false);
      setIsGeneratingWeekly(false);
    }
  };

  const handleCopyWeeklySummary = async () => {
    if (!weeklyData?.summary) return;
    try {
      await navigator.clipboard.writeText(weeklyData.summary);
      toast({ title: "Weekly summary copied", description: "Weekly summary copied to clipboard." });
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };

  const handleGenerateTestFile = async (recommendation: RecommendedTestFile) => {
    if (generatingTestFilePath) return;
    setGeneratingTestFilePath(recommendation.testFilePath);

    try {
      const res = await fetch("/api/orchestrator/generate-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          buildingId: recommendation.buildingId,
          filePath: recommendation.sourceFilePath,
        }),
      });

      const data = await res.json() as Partial<GeneratedTestFile> & { error?: string; message?: string };
      if (!res.ok || !data.testFilePath || !data.testContent || !data.language) {
        throw new Error(data.error ?? data.message ?? "Failed to generate test file");
      }

      setGeneratedTestFile({
        testFilePath: data.testFilePath,
        testContent: data.testContent,
        language: data.language,
      });
      setGeneratedTestOpen(true);
    } catch {
      toast({ title: "Test generation failed", variant: "destructive" });
    } finally {
      setGeneratingTestFilePath(null);
    }
  };

  const handleCopyGeneratedTest = async () => {
    if (!generatedTestFile?.testContent) return;
    try {
      await navigator.clipboard.writeText(generatedTestFile.testContent);
      toast({ title: "Test copied", description: `${generatedTestFile.testFilePath} copied to clipboard.` });
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };

  const runControlAction = async (
    key: string,
    endpoint: string,
    successTitle: string,
    body?: Record<string, unknown>,
  ) => {
    if (runningControlAction) return;
    setRunningControlAction(key);

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const data = await res.json() as { message?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? data.message ?? "Action failed");

      toast({ title: successTitle, description: data.message ?? undefined });
      refetchAgents();
      refetchHealth();

      if (endpoint.includes("wipe-all")) {
        setMayorMessages([]);
        setReportData(null);
        setSprintData(null);
        setWeeklyData(null);
        setGeneratedTestFile(null);
      }
    } catch {
      toast({ title: "Action failed", variant: "destructive" });
    } finally {
      setRunningControlAction(null);
    }
  };

  const handleWipeEverything = async () => {
    const confirmation = window.prompt("Type RESET to wipe everything:");
    if (confirmation !== WIPE_CONFIRMATION_TEXT) {
      toast({ title: "Wipe canceled", description: "Confirmation text did not match." });
      return;
    }
    await runControlAction(
      "wipe-all",
      "/api/orchestrator/controls/wipe-all",
      "All city data wiped",
      { confirmation: WIPE_CONFIRMATION_TEXT },
    );
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

          <div className="absolute top-4 left-4 z-20 flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLocation("/")}
              className="h-8 text-xs font-mono border-primary/30"
            >
              <Home size={12} className="mr-1.5" /> HOME
            </Button>
          </div>

          <div className="absolute top-4 right-4 z-20 flex gap-2" data-tour="share-btn">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs font-mono border-primary/30"
                >
                  <Settings2 size={12} className="mr-1.5" /> City Controls <ChevronDown size={10} className="ml-1" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel>City Controls</DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => setLocation("/")}>Load New Repo</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={runningControlAction !== null}
                  onSelect={() => {
                    void runControlAction("clear-events", "/api/orchestrator/controls/clear-events", "Events cleared");
                  }}
                >
                  <Trash2 size={13} /> Clear Event Stream
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={runningControlAction !== null}
                  onSelect={() => {
                    void runControlAction("reset-agent-stats", "/api/orchestrator/controls/reset-agent-stats", "Agent stats reset");
                  }}
                >
                  <RotateCcw size={13} /> Reset Agent Stats
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={runningControlAction !== null}
                  onSelect={() => {
                    void runControlAction("retire-all", "/api/orchestrator/controls/retire-all-agents", "All agents retired");
                  }}
                >
                  <UserX size={13} /> Retire All Agents
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={runningControlAction !== null}
                  onSelect={() => {
                    void runControlAction("full-reset", "/api/orchestrator/controls/full-reset", "Full reset complete");
                  }}
                >
                  <RotateCcw size={13} /> Full Reset (KB Session Included)
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={runningControlAction !== null}
                  onSelect={() => {
                    void handleWipeEverything();
                  }}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 size={13} /> Wipe Everything (Type RESET)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

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

          <div className="absolute bottom-4 left-4 z-20 w-[360px] max-w-[calc(100%-2rem)] glass-panel rounded-xl border border-primary/20 p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-primary">
                <MessageSquare size={12} /> Mayor Chat
              </div>
              <div className="flex items-center justify-end gap-1 flex-wrap">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void handlePlanSprint();
                  }}
                  disabled={isPlanningSprint}
                  className="h-7 border-primary/30 px-2 text-[10px] font-mono"
                >
                  {isPlanningSprint ? "Planning..." : "Plan Sprint"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void handleGenerateWeeklySummary();
                  }}
                  disabled={isGeneratingWeekly}
                  className="h-7 border-primary/30 px-2 text-[10px] font-mono"
                >
                  {isGeneratingWeekly ? "Working..." : "Weekly"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void handleRequestReport();
                  }}
                  disabled={isGeneratingReport}
                  className="h-7 border-primary/30 px-2 text-[10px] font-mono"
                >
                  <FileWarning size={11} className="mr-1" />
                  {isGeneratingReport ? "Generating..." : "Request Report"}
                </Button>
              </div>
            </div>

            <div className="mb-2 h-36 overflow-y-auto rounded border border-border/40 bg-black/30 p-2 text-xs font-mono">
              {mayorMessages.length === 0 ? (
                <div className="text-muted-foreground">Mayor channel idle...</div>
              ) : (
                <div className="space-y-2">
                  {mayorMessages.map(msg => (
                    <div key={msg.id} className={cn("rounded px-2 py-1", msg.role === "mayor" ? "bg-primary/10" : "bg-muted/20")}>
                      <div className="mb-1 text-[10px] uppercase tracking-widest text-muted-foreground">
                        {msg.role === "mayor" ? "Mayor" : "You"}
                      </div>
                      <div className="whitespace-pre-wrap text-[11px] leading-relaxed">{msg.text}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <input
                value={mayorInput}
                onChange={(e) => setMayorInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void handleSendMayorMessage();
                  }
                }}
                placeholder="Ask the mayor for next actions..."
                className="h-8 flex-1 rounded border border-border/40 bg-black/40 px-2 text-xs font-mono text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-primary/50"
              />
              <Button
                variant="default"
                size="sm"
                onClick={() => {
                  void handleSendMayorMessage();
                }}
                disabled={sendingMayorMessage || !mayorInput.trim()}
                className="h-8 px-3 text-xs font-mono"
              >
                {sendingMayorMessage ? <Loader2 size={11} className="animate-spin" /> : "Send"}
              </Button>
            </div>
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

      <Dialog open={reportOpen} onOpenChange={setReportOpen}>
        <DialogContent className="max-w-3xl border-primary/40 bg-background/95 font-mono">
          <DialogHeader>
            <DialogTitle className="text-primary">City Urgency Report</DialogTitle>
          </DialogHeader>

          <div className="text-xs text-muted-foreground">
            {reportData ? `Generated at ${reportData.generatedAt}` : "Report will appear once generation completes."}
          </div>

          <div className="max-h-[60vh] overflow-y-auto rounded border border-border/40 bg-black/35 p-3 text-xs leading-relaxed">
            {reportLoading && !reportData ? (
              <div className="flex items-center gap-2 text-muted-foreground"><Loader2 size={12} className="animate-spin" /> Building urgency report...</div>
            ) : (
              <pre className="whitespace-pre-wrap">{reportData?.report ?? "No report available."}</pre>
            )}
          </div>

          {reportData?.recommendedTestFiles && reportData.recommendedTestFiles.length > 0 && (
            <div className="rounded border border-primary/30 bg-black/25 p-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-primary">
                Recommended Test Files to Create
              </div>
              <div className="space-y-2">
                {reportData.recommendedTestFiles.map((recommendation) => (
                  <div key={recommendation.testFilePath} className="rounded border border-border/40 p-2 text-[11px]">
                    <div className="font-semibold text-foreground">{recommendation.testFilePath}</div>
                    <div className="text-muted-foreground">Source: {recommendation.sourceFilePath}</div>
                    <div className="text-muted-foreground">What to test: {recommendation.whatToTest.join(", ")}</div>
                    <div className="text-muted-foreground">Type: {recommendation.testType} · Priority: {recommendation.priority}</div>
                    <div className="mt-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={generatingTestFilePath !== null}
                        onClick={() => {
                          void handleGenerateTestFile(recommendation);
                        }}
                        className="h-7 text-[10px] font-mono"
                      >
                        {generatingTestFilePath === recommendation.testFilePath ? "Generating..." : "Generate"}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setReportOpen(false)} className="h-8 text-xs font-mono">Close</Button>
            <Button onClick={() => { void handleCopyReport(); }} disabled={!reportData?.report} className="h-8 text-xs font-mono">
              <Copy size={12} className="mr-1.5" /> Copy Full Report
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={sprintOpen} onOpenChange={setSprintOpen}>
        <DialogContent className="max-w-3xl border-primary/40 bg-background/95 font-mono">
          <DialogHeader>
            <DialogTitle className="text-primary">Sprint Plan</DialogTitle>
          </DialogHeader>

          <div className="text-xs text-muted-foreground">
            {sprintData ? `Generated at ${sprintData.generatedAt}` : "Sprint plan will appear once generation completes."}
          </div>

          <div className="max-h-[60vh] overflow-y-auto rounded border border-border/40 bg-black/35 p-3 text-xs leading-relaxed">
            {sprintLoading && !sprintData ? (
              <div className="flex items-center gap-2 text-muted-foreground"><Loader2 size={12} className="animate-spin" /> Building sprint plan...</div>
            ) : (
              <pre className="whitespace-pre-wrap">{sprintData?.plan ?? "No sprint plan available."}</pre>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setSprintOpen(false)} className="h-8 text-xs font-mono">Close</Button>
            <Button onClick={() => { void handleCopySprintPlan(); }} disabled={!sprintData?.plan} className="h-8 text-xs font-mono">
              <Copy size={12} className="mr-1.5" /> Copy Markdown
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={generatedTestOpen} onOpenChange={setGeneratedTestOpen}>
        <DialogContent className="max-w-3xl border-primary/40 bg-background/95 font-mono">
          <DialogHeader>
            <DialogTitle className="text-primary">Generated Test File</DialogTitle>
          </DialogHeader>

          <div className="text-xs text-muted-foreground">
            {generatedTestFile ? `${generatedTestFile.testFilePath} (${generatedTestFile.language})` : "No generated test file."}
          </div>

          <div className="max-h-[60vh] overflow-y-auto rounded border border-border/40 bg-black/35 p-3 text-xs leading-relaxed">
            <pre className="whitespace-pre-wrap">{generatedTestFile?.testContent ?? "No generated test content."}</pre>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setGeneratedTestOpen(false)} className="h-8 text-xs font-mono">Close</Button>
            <Button onClick={() => { void handleCopyGeneratedTest(); }} disabled={!generatedTestFile?.testContent} className="h-8 text-xs font-mono">
              <Copy size={12} className="mr-1.5" /> Copy
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={weeklyOpen} onOpenChange={setWeeklyOpen}>
        <DialogContent className="max-w-3xl border-primary/40 bg-background/95 font-mono">
          <DialogHeader>
            <DialogTitle className="text-primary">Weekly Summary</DialogTitle>
          </DialogHeader>

          <div className="text-xs text-muted-foreground">
            {weeklyData ? `Generated at ${weeklyData.generatedAt} (${weeklyData.range})` : "Summary will appear once generation completes."}
          </div>

          <div className="max-h-[60vh] overflow-y-auto rounded border border-border/40 bg-black/35 p-3 text-xs leading-relaxed">
            {weeklyLoading && !weeklyData ? (
              <div className="flex items-center gap-2 text-muted-foreground"><Loader2 size={12} className="animate-spin" /> Building weekly summary...</div>
            ) : (
              <pre className="whitespace-pre-wrap">{weeklyData?.summary ?? "No weekly summary available."}</pre>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setWeeklyOpen(false)} className="h-8 text-xs font-mono">Close</Button>
            <Button onClick={() => { void handleCopyWeeklySummary(); }} disabled={!weeklyData?.summary} className="h-8 text-xs font-mono">
              <Copy size={12} className="mr-1.5" /> Copy Markdown
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <ShortcutsPanel open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      {showTour && <GuidedTour onDone={endTour} />}
    </AppLayout>
  );
}
