import { useState, useEffect, useRef, Component, useCallback, useMemo } from "react";
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
  FlaskConical,
  TerminalSquare,
  ThumbsUp,
  ThumbsDown,
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from "@/components/ui/dialog";

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

type ReportSectionId = "summary" | "critical" | "high" | "medium" | "low" | "recommended-tests" | "city-stats";

interface ParsedReportSections {
  critical: string[];
  high: string[];
  medium: string[];
  low: string[];
  cityStats: string[];
}

function normalizeHeadingTitle(line: string): string {
  return line
    .replace(/^#{1,6}\s*/, "")
    .replace(/\(\s*\d+\s*\)\s*$/, "")
    .replace(/:$/, "")
    .trim()
    .toLowerCase();
}

function extractReportSectionItems(report: string, sectionTitle: string): string[] {
  if (!report.trim()) return [];

  const wanted = sectionTitle.trim().toLowerCase();
  const lines = report.split(/\r?\n/);
  const items: string[] = [];
  let capturing = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (/^#{1,6}\s+/.test(line)) {
      const heading = normalizeHeadingTitle(line);
      if (capturing && heading !== wanted) break;
      capturing = heading.startsWith(wanted);
      continue;
    }

    if (!capturing) continue;
    if (!line || line === "```" || line.startsWith("```")) continue;

    if (line.startsWith("- ") || line.startsWith("* ")) {
      items.push(line.replace(/^[-*]\s+/, ""));
      continue;
    }

    // Keep plain lines for sections that might not use bullet formatting.
    if (wanted === "city stats") {
      items.push(line);
    }
  }

  return items;
}

function parseReportSections(report: string): ParsedReportSections {
  const parsed: ParsedReportSections = {
    critical: extractReportSectionItems(report, "critical"),
    high: extractReportSectionItems(report, "high"),
    medium: extractReportSectionItems(report, "medium"),
    low: extractReportSectionItems(report, "low"),
    cityStats: extractReportSectionItems(report, "city stats"),
  };

  if (parsed.cityStats.length === 0) {
    const cityStatsLine = report
      .split(/\r?\n/)
      .map(line => line.trim())
      .find(line => line.toLowerCase().startsWith("current city stats:"));

    if (cityStatsLine) parsed.cityStats.push(cityStatsLine);
  }

  return parsed;
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

interface ImportReviewResponse {
  verdictsProcessed: number;
  agentsUpdated: string[];
  kbEntriesAdded: number;
  accuracyChanges: Array<{ agentName: string; before: number; after: number }>;
  mayorMessage?: string;
  lastReviewSummary?: string;
}

interface AlchemistResult {
  id: number | null;
  command: string;
  status: "success" | "failed" | "blocked" | "timeout";
  exitCode: number | null;
  durationMs: number;
  reason?: string | null;
  startedAt?: string;
}

interface AlchemistResultsResponse {
  results: AlchemistResult[];
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
  const [importReviewOpen, setImportReviewOpen] = useState(false);
  const [importReviewText, setImportReviewText] = useState("");
  const [processingReviewImport, setProcessingReviewImport] = useState(false);
  const [importReviewResult, setImportReviewResult] = useState<ImportReviewResponse | null>(null);
  const [recommendationFeedback, setRecommendationFeedback] = useState<Record<string, "approved" | "rejected">>({});
  const [savingRecommendationPath, setSavingRecommendationPath] = useState<string | null>(null);
  const [hiddenRecommendations, setHiddenRecommendations] = useState<Set<string>>(new Set());
  const [activeReportSection, setActiveReportSection] = useState<ReportSectionId>("summary");
  const [generatingTestFilePath, setGeneratingTestFilePath] = useState<string | null>(null);
  const [generatedTestFile, setGeneratedTestFile] = useState<GeneratedTestFile | null>(null);
  const [generatedTestOpen, setGeneratedTestOpen] = useState(false);
  const [runningControlAction, setRunningControlAction] = useState<string | null>(null);
  const [alchemistOpen, setAlchemistOpen] = useState(false);
  const [alchemistCommand, setAlchemistCommand] = useState("pnpm run typecheck");
  const [alchemistRunning, setAlchemistRunning] = useState(false);
  const [alchemistResults, setAlchemistResults] = useState<AlchemistResult[]>([]);
  const mayorSessionIdRef = useRef<string>(getOrCreateMayorSessionId());
  const reportScrollRef = useRef<HTMLDivElement | null>(null);
  const reportSectionRefs = useRef<Record<ReportSectionId, HTMLElement | null>>({
    summary: null,
    critical: null,
    high: null,
    medium: null,
    low: null,
    "recommended-tests": null,
    "city-stats": null,
  });
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

  const { activeBuildings, activeBuildingColors } = useMemo(() => {
    const resolvedIds = new Set<string>();
    const colorById = new Map<string, string>();
    const buildings = (layout?.districts ?? []).flatMap((district) => district.buildings ?? []);

    if (buildings.length === 0) {
      return { activeBuildings: resolvedIds, activeBuildingColors: colorById };
    }

    const ids = new Set(buildings.map((building) => building.id));
    const lowerIdMap = new Map(buildings.map((building) => [building.id.toLowerCase(), building.id] as const));

    const resolveByRawId = (rawId: string): string | null => {
      if (ids.has(rawId)) return rawId;

      const lowerRawId = rawId.toLowerCase();
      const lowerMatch = lowerIdMap.get(lowerRawId);
      if (lowerMatch) return lowerMatch;

      for (const building of buildings) {
        const candidate = building.id.toLowerCase();
        if (candidate.endsWith(lowerRawId) || lowerRawId.endsWith(candidate)) {
          return building.id;
        }
      }

      const rawTail = lowerRawId.startsWith("building-") ? lowerRawId.slice("building-".length) : lowerRawId;
      for (const building of buildings) {
        if (building.id.toLowerCase().endsWith(rawTail)) {
          return building.id;
        }
      }

      return null;
    };

    const resolveByPosition = (agent: Agent): string | null => {
      const agentX = typeof agent.x === "number" ? agent.x : null;
      const agentY = typeof agent.y === "number" ? agent.y : null;
      if (agentX === null || agentY === null) return null;

      const containing = buildings.find((building) => (
        agentX >= building.x
        && agentX <= building.x + building.width
        && agentY >= building.y
        && agentY <= building.y + building.height
      ));
      if (containing) return containing.id;

      let nearestId: string | null = null;
      let nearestDistance = Number.POSITIVE_INFINITY;
      for (const building of buildings) {
        const centerX = building.x + building.width / 2;
        const centerY = building.y + building.height / 2;
        const deltaX = agentX - centerX;
        const deltaY = agentY - centerY;
        const distance = deltaX * deltaX + deltaY * deltaY;
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestId = building.id;
        }
      }

      return nearestDistance <= 160 * 160 ? nearestId : null;
    };

    for (const agent of agents) {
      if (agent.status !== "working") continue;

      const rawId =
        agent.currentBuilding
        ?? (agent as Agent & { currentBuildingId?: string | null }).currentBuildingId
        ?? null;

      const resolvedId = (rawId ? resolveByRawId(rawId) : null) ?? resolveByPosition(agent);
      if (!resolvedId) continue;

      resolvedIds.add(resolvedId);
      if (!colorById.has(resolvedId)) {
        colorById.set(resolvedId, agent.color || "#00fff7");
      }
    }

    return { activeBuildings: resolvedIds, activeBuildingColors: colorById };
  }, [agents, layout]);

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
    } else if (type === "alchemist_result") {
      const alchemistPayload = payload as {
        id?: number | null;
        command?: string;
        status?: AlchemistResult["status"];
        exitCode?: number | null;
        durationMs?: number;
        reason?: string | null;
      };

      const liveResult: AlchemistResult = {
        id: typeof alchemistPayload.id === "number" ? alchemistPayload.id : null,
        command: alchemistPayload.command ?? "unknown command",
        status: alchemistPayload.status ?? "failed",
        exitCode: typeof alchemistPayload.exitCode === "number" ? alchemistPayload.exitCode : null,
        durationMs: typeof alchemistPayload.durationMs === "number" ? alchemistPayload.durationMs : 0,
        reason: alchemistPayload.reason ?? null,
      };
      setAlchemistResults(prev => [liveResult, ...prev].slice(0, 12));
      refetchHealth();
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

  const visibleRecommendedTestFiles = useMemo(() => {
    const list = reportData?.recommendedTestFiles ?? [];
    if (hiddenRecommendations.size === 0) return list;
    return list.filter(item => !hiddenRecommendations.has(item.testFilePath));
  }, [reportData?.recommendedTestFiles, hiddenRecommendations]);

  const recommendationFallbackByPriority = useMemo(() => {
    const grouped: Record<"critical" | "high" | "medium", string[]> = {
      critical: [],
      high: [],
      medium: [],
    };

    for (const recommendation of visibleRecommendedTestFiles) {
      const line = `${recommendation.sourceFilePath} -> ${recommendation.testFilePath}`;
      if (recommendation.priority === "critical") grouped.critical.push(line);
      else if (recommendation.priority === "high") grouped.high.push(line);
      else grouped.medium.push(line);
    }

    return grouped;
  }, [visibleRecommendedTestFiles]);

  const parsedReportSections = useMemo(() => parseReportSections(reportData?.report ?? ""), [reportData?.report]);

  const reportSectionItems = useMemo(() => {
    return {
      critical: parsedReportSections.critical.length > 0 ? parsedReportSections.critical : recommendationFallbackByPriority.critical,
      high: parsedReportSections.high.length > 0 ? parsedReportSections.high : recommendationFallbackByPriority.high,
      medium: parsedReportSections.medium.length > 0 ? parsedReportSections.medium : recommendationFallbackByPriority.medium,
      low: parsedReportSections.low,
      cityStats: parsedReportSections.cityStats.length > 0
        ? parsedReportSections.cityStats
        : (reportData?.summary ? [reportData.summary] : []),
    };
  }, [parsedReportSections, recommendationFallbackByPriority, reportData?.summary]);

  const reportNavSections = useMemo(() => {
    return [
      { id: "summary" as const, icon: "📊", label: "Summary", count: null },
      { id: "critical" as const, icon: "🔴", label: "Critical", count: reportSectionItems.critical.length },
      { id: "high" as const, icon: "🟠", label: "High", count: reportSectionItems.high.length },
      { id: "medium" as const, icon: "🟡", label: "Medium", count: reportSectionItems.medium.length },
      { id: "low" as const, icon: "⚪", label: "Low", count: reportSectionItems.low.length },
      { id: "recommended-tests" as const, icon: "🧪", label: "Recommended Tests", count: visibleRecommendedTestFiles.length },
      { id: "city-stats" as const, icon: "📈", label: "City Stats", count: reportSectionItems.cityStats.length },
    ];
  }, [reportSectionItems, visibleRecommendedTestFiles.length]);

  const setReportSectionRef = useCallback((sectionId: ReportSectionId, element: HTMLElement | null) => {
    reportSectionRefs.current[sectionId] = element;
  }, []);

  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    if (search.get("openReport") === "1") {
      setReportOpen(true);
    }
  }, []);

  const scrollToReportSection = useCallback((sectionId: ReportSectionId) => {
    const target = reportSectionRefs.current[sectionId];
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    setActiveReportSection(sectionId);
  }, []);

  useEffect(() => {
    if (!reportOpen) return;

    const root = reportScrollRef.current;
    if (!root) return;

    const observer = new IntersectionObserver(
      (entries) => {
        let bestEntry: IntersectionObserverEntry | null = null;

        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          if (!bestEntry || entry.intersectionRatio > bestEntry.intersectionRatio) {
            bestEntry = entry;
          }
        }

        if (!bestEntry) return;

        const matched = Object.entries(reportSectionRefs.current).find(([, element]) => element === bestEntry?.target);
        if (!matched?.[0]) return;

        setActiveReportSection(matched[0] as ReportSectionId);
      },
      {
        root,
        threshold: [0.2, 0.4, 0.7],
        rootMargin: "-10% 0px -55% 0px",
      }
    );

    for (const sectionId of reportNavSections.map(section => section.id)) {
      const sectionElement = reportSectionRefs.current[sectionId];
      if (sectionElement) observer.observe(sectionElement);
    }

    return () => observer.disconnect();
  }, [reportOpen, reportData?.report, reportNavSections, visibleRecommendedTestFiles.length]);

  useEffect(() => {
    if (!reportOpen) return;
    setRecommendationFeedback({});
    setHiddenRecommendations(new Set());
    setSavingRecommendationPath(null);
    setActiveReportSection("summary");
    if (reportScrollRef.current) reportScrollRef.current.scrollTop = 0;
  }, [reportOpen, reportData?.generatedAt, reportData?.cacheBust]);

  const handleRecommendationFeedback = async (
    recommendation: RecommendedTestFile,
    verdict: "approved" | "rejected",
  ) => {
    const key = recommendation.testFilePath;
    if (savingRecommendationPath === key) return;

    setSavingRecommendationPath(key);
    try {
      const res = await fetch("/api/orchestrator/recommendation-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          verdict,
          buildingId: recommendation.buildingId,
          sourceFilePath: recommendation.sourceFilePath,
          testFilePath: recommendation.testFilePath,
          priority: recommendation.priority,
          testType: recommendation.testType,
        }),
      });

      const data = await res.json() as { success?: boolean; message?: string; error?: string };
      if (!res.ok || !data.success) {
        throw new Error(data.error ?? data.message ?? "Failed to save recommendation feedback");
      }

      setRecommendationFeedback(prev => ({
        ...prev,
        [key]: verdict,
      }));

      if (verdict === "rejected") {
        window.setTimeout(() => {
          setHiddenRecommendations(prev => {
            const next = new Set(prev);
            next.add(key);
            return next;
          });
        }, 400);
      }

      toast({ title: "Feedback saved to agent memory." });
      refetchAgents();
    } catch {
      toast({ title: "Failed to save recommendation feedback", variant: "destructive" });
    } finally {
      setSavingRecommendationPath((current) => (current === key ? null : current));
    }
  };

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

  const handleProcessImportedReview = async () => {
    const reviewText = importReviewText.trim();
    if (!reviewText || processingReviewImport) return;

    setProcessingReviewImport(true);
    try {
      const res = await fetch("/api/orchestrator/import-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewText }),
      });

      const data = await res.json() as Partial<ImportReviewResponse> & { error?: string; message?: string };
      if (!res.ok || typeof data.verdictsProcessed !== "number" || !Array.isArray(data.agentsUpdated) || typeof data.kbEntriesAdded !== "number" || !Array.isArray(data.accuracyChanges)) {
        throw new Error(data.error ?? data.message ?? "Failed to import review");
      }

      const typed: ImportReviewResponse = {
        verdictsProcessed: data.verdictsProcessed,
        agentsUpdated: data.agentsUpdated,
        kbEntriesAdded: data.kbEntriesAdded,
        accuracyChanges: data.accuracyChanges,
        mayorMessage: data.mayorMessage,
        lastReviewSummary: data.lastReviewSummary,
      };

      setImportReviewResult(typed);
      setImportReviewText("");
      setImportReviewOpen(false);

      const bestGain = typed.accuracyChanges
        .slice()
        .sort((a, b) => (b.after - b.before) - (a.after - a.before))[0];

      const fallbackMayorMessage = bestGain
        ? `Got it. I've updated ${typed.agentsUpdated.length} agent(s) based on this review. ${bestGain.agentName} accuracy improved to ${bestGain.after.toFixed(1)}%.`
        : `Got it. I've updated ${typed.agentsUpdated.length} agent(s) based on this review. No measurable accuracy increase yet, but I stored the learning.`;

      appendMayorMessage("mayor", typed.mayorMessage ?? fallbackMayorMessage);

      toast({
        title: "AI review imported",
        description: `Processed ${typed.verdictsProcessed} verdict(s), updated ${typed.agentsUpdated.length} agent(s), and added ${typed.kbEntriesAdded} KB entr${typed.kbEntriesAdded === 1 ? "y" : "ies"}.`,
      });

      refetchAgents();
      refetchHealth();
    } catch {
      toast({ title: "Failed to import AI review", variant: "destructive" });
    } finally {
      setProcessingReviewImport(false);
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

  const fetchAlchemistResults = useCallback(async () => {
    try {
      const res = await fetch("/api/alchemist/results?limit=8", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json() as AlchemistResultsResponse;
      const nextResults = Array.isArray(data.results) ? data.results : [];
      setAlchemistResults(nextResults);
    } catch {
      // Keep last known alchemist results if polling fails.
    }
  }, []);

  const runAlchemist = useCallback(async (command: string) => {
    const trimmed = command.trim();
    if (!trimmed || alchemistRunning) return;

    setAlchemistRunning(true);
    try {
      const res = await fetch("/api/alchemist/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: trimmed, triggeredBy: "city-controls" }),
      });

      const data = await res.json() as Partial<AlchemistResult> & { error?: string; message?: string };
      if (!res.ok || !data.command || !data.status) {
        throw new Error(data.error ?? data.message ?? "Alchemist command failed");
      }

      const result: AlchemistResult = {
        id: typeof data.id === "number" ? data.id : null,
        command: data.command,
        status: data.status,
        exitCode: typeof data.exitCode === "number" ? data.exitCode : null,
        durationMs: typeof data.durationMs === "number" ? data.durationMs : 0,
        reason: data.reason,
        startedAt: data.startedAt,
      };

      setAlchemistResults(prev => [result, ...prev].slice(0, 12));
      refetchHealth();

      toast({
        title: result.status === "success" ? "Alchemist completed" : "Alchemist finished with issues",
        description: `${result.status.toUpperCase()} — ${result.command}`,
        variant: result.status === "success" ? "default" : "destructive",
      });
    } catch {
      toast({ title: "Alchemist run failed", variant: "destructive" });
    } finally {
      setAlchemistRunning(false);
      void fetchAlchemistResults();
    }
  }, [alchemistRunning, fetchAlchemistResults, refetchHealth, toast]);

  useEffect(() => {
    void fetchAlchemistResults();
    const timer = setInterval(() => {
      void fetchAlchemistResults();
    }, 8000);

    return () => clearInterval(timer);
  }, [fetchAlchemistResults]);

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
                <DropdownMenuItem
                  onSelect={() => {
                    setAlchemistOpen(true);
                  }}
                >
                  <FlaskConical size={13} /> Open Alchemist Console
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
                  onClick={() => setImportReviewOpen(true)}
                  disabled={processingReviewImport}
                  className="h-7 border-primary/30 px-2 text-[10px] font-mono"
                >
                  {processingReviewImport ? "Importing..." : "Import AI Review"}
                </Button>
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

            {importReviewResult && (
              <div className="mb-2 rounded border border-primary/30 bg-black/25 px-2 py-1 text-[10px] font-mono text-muted-foreground">
                Last AI review import: {importReviewResult.verdictsProcessed} verdict(s), {importReviewResult.agentsUpdated.length} agent(s) updated, {importReviewResult.kbEntriesAdded} KB entr{importReviewResult.kbEntriesAdded === 1 ? "y" : "ies"} added.
              </div>
            )}

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
              activeBuildings={activeBuildings}
              activeBuildingColors={activeBuildingColors}
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
        <DialogContent className="left-1/2 top-1/2 w-[calc(100vw-20px)] max-w-none translate-x-[-50%] translate-y-[-50%] p-0 sm:w-[90vw] max-h-[85vh] border-primary/40 bg-background/95 font-mono [&>button]:hidden">
          <div className="flex h-[85vh] min-h-0 flex-col">
            <div className="sticky top-0 z-30 border-b border-primary/30 bg-background/95 px-3 py-3 sm:px-5">
              <div className="flex items-start justify-between gap-3">
                <DialogHeader className="space-y-0 text-left">
                  <DialogTitle className="text-primary text-sm sm:text-base">
                    City Urgency Report {reportData ? `- ${reportData.generatedAt}` : "- pending generation"}
                  </DialogTitle>
                </DialogHeader>

                <div className="flex items-center gap-2">
                  <Button
                    onClick={() => { void handleCopyReport(); }}
                    disabled={!reportData?.report}
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-[10px] font-mono border-primary/30"
                  >
                    <Copy size={12} className="mr-1.5" /> Copy
                  </Button>
                  <DialogClose asChild>
                    <Button variant="outline" size="sm" className="h-7 px-2 text-[10px] font-mono border-primary/30">
                      Close
                    </Button>
                  </DialogClose>
                </div>
              </div>
            </div>

            <div className="min-h-0 flex flex-1 overflow-hidden">
              <aside className="w-12 shrink-0 border-r border-border/30 bg-black/20 md:w-52">
                <div className="sticky top-0 p-2 md:p-3">
                  <div className="mb-2 hidden text-[10px] font-semibold uppercase tracking-widest text-primary md:block">Sections</div>
                  <div className="space-y-1 animate-in slide-in-from-left-4 duration-300">
                    {reportNavSections.map((section) => (
                      <button
                        key={section.id}
                        type="button"
                        onClick={() => scrollToReportSection(section.id)}
                        className={cn(
                          "group flex w-full items-center gap-2 rounded border px-1.5 py-1.5 text-left text-[10px] font-mono transition-colors",
                          activeReportSection === section.id
                            ? "border-primary/60 bg-primary/20 text-primary"
                            : "border-border/30 bg-black/30 text-muted-foreground hover:border-primary/40 hover:text-foreground"
                        )}
                        title={`${section.icon} ${section.label}${section.count !== null ? ` (${section.count})` : ""}`}
                      >
                        <span className="text-sm leading-none">{section.icon}</span>
                        <span className="hidden truncate md:inline">{section.label}{section.count !== null ? ` (${section.count})` : ""}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </aside>

              <div ref={reportScrollRef} className="min-h-0 flex-1 overflow-y-auto scroll-smooth px-3 py-3 sm:px-5">
                {reportLoading && !reportData ? (
                  <div className="rounded border border-border/40 bg-black/35 p-3 text-xs text-muted-foreground flex items-center gap-2">
                    <Loader2 size={12} className="animate-spin" /> Building urgency report...
                  </div>
                ) : (
                  <div className="space-y-4 text-xs leading-relaxed">
                    <section
                      id="report-section-summary"
                      ref={(element) => setReportSectionRef("summary", element)}
                      className="scroll-mt-24 rounded border border-primary/30 bg-black/25 p-3"
                    >
                      <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-primary">📊 Summary</div>
                      <div className="text-foreground/90">{reportData?.summary ?? "No report summary available."}</div>
                      <pre className="mt-3 max-h-56 overflow-y-auto whitespace-pre-wrap rounded border border-border/30 bg-black/35 p-2 text-[11px] text-muted-foreground">
                        {reportData?.report ?? "No report available."}
                      </pre>
                    </section>

                    <section
                      id="report-section-critical"
                      ref={(element) => setReportSectionRef("critical", element)}
                      className="scroll-mt-24 rounded border border-red-500/30 bg-red-500/5 p-3"
                    >
                      <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-red-300">🔴 Critical ({reportSectionItems.critical.length})</div>
                      {reportSectionItems.critical.length === 0 ? (
                        <div className="text-muted-foreground">No critical items in this report.</div>
                      ) : (
                        <ul className="space-y-1">
                          {reportSectionItems.critical.map((item, idx) => (
                            <li key={`critical-${idx}`} className="rounded border border-red-500/20 bg-black/30 px-2 py-1">{item}</li>
                          ))}
                        </ul>
                      )}
                    </section>

                    <section
                      id="report-section-high"
                      ref={(element) => setReportSectionRef("high", element)}
                      className="scroll-mt-24 rounded border border-orange-500/30 bg-orange-500/5 p-3"
                    >
                      <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-orange-300">🟠 High ({reportSectionItems.high.length})</div>
                      {reportSectionItems.high.length === 0 ? (
                        <div className="text-muted-foreground">No high-priority items in this report.</div>
                      ) : (
                        <ul className="space-y-1">
                          {reportSectionItems.high.map((item, idx) => (
                            <li key={`high-${idx}`} className="rounded border border-orange-500/20 bg-black/30 px-2 py-1">{item}</li>
                          ))}
                        </ul>
                      )}
                    </section>

                    <section
                      id="report-section-medium"
                      ref={(element) => setReportSectionRef("medium", element)}
                      className="scroll-mt-24 rounded border border-yellow-500/30 bg-yellow-500/5 p-3"
                    >
                      <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-yellow-200">🟡 Medium ({reportSectionItems.medium.length})</div>
                      {reportSectionItems.medium.length === 0 ? (
                        <div className="text-muted-foreground">No medium-priority items in this report.</div>
                      ) : (
                        <ul className="space-y-1">
                          {reportSectionItems.medium.map((item, idx) => (
                            <li key={`medium-${idx}`} className="rounded border border-yellow-500/20 bg-black/30 px-2 py-1">{item}</li>
                          ))}
                        </ul>
                      )}
                    </section>

                    <section
                      id="report-section-low"
                      ref={(element) => setReportSectionRef("low", element)}
                      className="scroll-mt-24 rounded border border-slate-400/30 bg-slate-500/5 p-3"
                    >
                      <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-200">⚪ Low ({reportSectionItems.low.length})</div>
                      {reportSectionItems.low.length === 0 ? (
                        <div className="text-muted-foreground">No low-priority items in this report.</div>
                      ) : (
                        <ul className="space-y-1">
                          {reportSectionItems.low.map((item, idx) => (
                            <li key={`low-${idx}`} className="rounded border border-slate-400/20 bg-black/30 px-2 py-1">{item}</li>
                          ))}
                        </ul>
                      )}
                    </section>

                    <section
                      id="report-section-recommended-tests"
                      ref={(element) => setReportSectionRef("recommended-tests", element)}
                      className="scroll-mt-24 rounded border border-primary/30 bg-black/25 p-3"
                    >
                      <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-primary">🧪 Recommended Tests ({visibleRecommendedTestFiles.length})</div>
                      {visibleRecommendedTestFiles.length === 0 ? (
                        <div className="text-muted-foreground">No recommended test files currently listed.</div>
                      ) : (
                        <div className="space-y-2">
                          {visibleRecommendedTestFiles.map((recommendation) => {
                            const feedback = recommendationFeedback[recommendation.testFilePath];
                            const savingFeedback = savingRecommendationPath === recommendation.testFilePath;
                            const approved = feedback === "approved";
                            const rejected = feedback === "rejected";

                            return (
                              <div key={recommendation.testFilePath} className="rounded border border-border/40 p-2 text-[11px]">
                                <div className="font-semibold text-foreground">{recommendation.testFilePath}</div>
                                <div className="text-muted-foreground">Source: {recommendation.sourceFilePath}</div>
                                <div className="text-muted-foreground">What to test: {recommendation.whatToTest.join(", ")}</div>
                                <div className="text-muted-foreground">Type: {recommendation.testType} · Priority: {recommendation.priority}</div>
                                <div className="mt-2 flex items-center gap-1.5">
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    disabled={savingFeedback || rejected}
                                    onClick={() => {
                                      void handleRecommendationFeedback(recommendation, "approved");
                                    }}
                                    className={cn(
                                      "h-7 px-2 text-[10px] font-mono",
                                      approved ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300" : ""
                                    )}
                                    title="Approve suggestion without generating"
                                  >
                                    {approved ? "✓ Noted" : <ThumbsUp size={12} />}
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    disabled={savingFeedback || rejected}
                                    onClick={() => {
                                      void handleRecommendationFeedback(recommendation, "rejected");
                                    }}
                                    className={cn(
                                      "h-7 px-2 text-[10px] font-mono",
                                      rejected ? "border-red-500/50 bg-red-500/15 text-red-300" : ""
                                    )}
                                    title="Reject suggestion and skip this pattern"
                                  >
                                    {rejected ? "✗ Skipped" : <ThumbsDown size={12} />}
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={generatingTestFilePath !== null || rejected}
                                    onClick={() => {
                                      void handleGenerateTestFile(recommendation);
                                    }}
                                    className="h-7 text-[10px] font-mono"
                                  >
                                    {generatingTestFilePath === recommendation.testFilePath ? "GENERATING..." : "GENERATE"}
                                  </Button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </section>

                    <section
                      id="report-section-city-stats"
                      ref={(element) => setReportSectionRef("city-stats", element)}
                      className="scroll-mt-24 rounded border border-blue-500/30 bg-blue-500/5 p-3"
                    >
                      <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-blue-200">📈 City Stats ({reportSectionItems.cityStats.length})</div>
                      {reportSectionItems.cityStats.length === 0 ? (
                        <div className="text-muted-foreground">No city stats were extracted from this report.</div>
                      ) : (
                        <ul className="space-y-1">
                          {reportSectionItems.cityStats.map((item, idx) => (
                            <li key={`city-stats-${idx}`} className="rounded border border-blue-500/20 bg-black/30 px-2 py-1">{item}</li>
                          ))}
                        </ul>
                      )}
                    </section>
                  </div>
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={importReviewOpen} onOpenChange={setImportReviewOpen}>
        <DialogContent className="max-w-3xl border-primary/40 bg-background/95 font-mono">
          <DialogHeader>
            <DialogTitle className="text-primary">Import AI Review</DialogTitle>
          </DialogHeader>

          <div className="text-xs text-muted-foreground">
            Paste the full "CODECITY AI REVIEW RESULT" response from Claude or Copilot.
          </div>

          <textarea
            value={importReviewText}
            onChange={(event) => setImportReviewText(event.target.value)}
            placeholder="CODECITY AI REVIEW RESULT\n[verdicts]\n[implemented fixes]\n[agent learning instructions]"
            className="min-h-[280px] w-full rounded border border-border/40 bg-black/35 p-3 text-xs leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-primary/50"
          />

          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setImportReviewOpen(false)}
              disabled={processingReviewImport}
              className="h-8 text-xs font-mono"
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                void handleProcessImportedReview();
              }}
              disabled={processingReviewImport || !importReviewText.trim()}
              className="h-8 text-xs font-mono"
            >
              {processingReviewImport ? <Loader2 size={11} className="animate-spin" /> : "Process Review"}
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

      <Dialog open={alchemistOpen} onOpenChange={setAlchemistOpen}>
        <DialogContent className="max-w-3xl border-primary/40 bg-background/95 font-mono">
          <DialogHeader>
            <DialogTitle className="text-primary flex items-center gap-2">
              <TerminalSquare size={16} /> Alchemist Console
            </DialogTitle>
          </DialogHeader>

          <div className="text-xs text-muted-foreground">
            Execute guarded maintenance commands and track runtime outcomes.
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Button
              variant="outline"
              className="h-8 text-xs font-mono"
              onClick={() => {
                const cmd = "pnpm run typecheck";
                setAlchemistCommand(cmd);
                void runAlchemist(cmd);
              }}
              disabled={alchemistRunning}
            >
              Workspace Typecheck
            </Button>
            <Button
              variant="outline"
              className="h-8 text-xs font-mono"
              onClick={() => {
                const cmd = "pnpm --filter @workspace/api-server run typecheck";
                setAlchemistCommand(cmd);
                void runAlchemist(cmd);
              }}
              disabled={alchemistRunning}
            >
              API Typecheck
            </Button>
            <Button
              variant="outline"
              className="h-8 text-xs font-mono"
              onClick={() => {
                const cmd = "pnpm --filter @workspace/software-city run typecheck";
                setAlchemistCommand(cmd);
                void runAlchemist(cmd);
              }}
              disabled={alchemistRunning}
            >
              UI Typecheck
            </Button>
          </div>

          <div className="flex gap-2">
            <input
              value={alchemistCommand}
              onChange={(event) => setAlchemistCommand(event.target.value)}
              placeholder="pnpm run typecheck"
              className="h-9 flex-1 rounded border border-border/40 bg-black/40 px-2 text-xs font-mono text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-primary/50"
            />
            <Button
              onClick={() => { void runAlchemist(alchemistCommand); }}
              disabled={alchemistRunning || !alchemistCommand.trim()}
              className="h-9 px-3 text-xs font-mono"
            >
              {alchemistRunning ? "Running..." : "Run"}
            </Button>
          </div>

          <div className="max-h-[280px] overflow-y-auto rounded border border-border/40 bg-black/35 p-3 text-xs leading-relaxed space-y-2">
            {alchemistResults.length === 0 ? (
              <div className="text-muted-foreground">No execution results yet.</div>
            ) : (
              alchemistResults.map((result, index) => (
                <div key={`${result.id ?? "tmp"}-${index}`} className="rounded border border-border/40 bg-black/30 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className={cn(
                      "text-[10px] font-semibold uppercase tracking-widest",
                      result.status === "success"
                        ? "text-emerald-300"
                        : result.status === "blocked"
                          ? "text-yellow-300"
                          : "text-red-300"
                    )}>
                      {result.status}
                    </span>
                    <span className="text-[10px] text-muted-foreground">{(result.durationMs / 1000).toFixed(1)}s</span>
                  </div>
                  <div className="mt-1 break-all text-[11px] text-foreground">{result.command}</div>
                  {result.reason && (
                    <div className="mt-1 text-[10px] text-muted-foreground">{result.reason}</div>
                  )}
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      <ShortcutsPanel open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      {showTour && <GuidedTour onDone={endTour} />}
    </AppLayout>
  );
}
