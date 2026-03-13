import { Link, useLocation } from "wouter";
import { Activity, Building2, Bot, BookOpen, ChevronRight, Terminal, Menu, X, Trophy, BarChart3, Settings } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { useGetEventStream } from "@workspace/api-client-react";
import { format } from "date-fns";
import { useWebSocket } from "@/hooks/useWebSocket";

const NAV_ITEMS = [
  { href: "/city", icon: Building2, label: "City View" },
  { href: "/agents", icon: Bot, label: "Agents Dashboard" },
  { href: "/knowledge", icon: BookOpen, label: "Knowledge Base" },
  { href: "/leaderboard", icon: Trophy, label: "Leaderboard" },
  { href: "/metrics", icon: BarChart3, label: "Live Metrics" },
  { href: "/settings", icon: Settings, label: "Settings" },
];

interface LocalEvent {
  id: string;
  type: string;
  message: string;
  severity: string;
  buildingName?: string;
  timestamp: string;
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [wsEvents, setWsEvents] = useState<LocalEvent[]>([]);
  const { lastMessage } = useWebSocket();

  useEffect(() => {
    if (!lastMessage) return;
    if (lastMessage.type === "event_log") {
      const payload = lastMessage.payload;
      const evt: LocalEvent = {
        id: `ws-${Date.now()}-${Math.random()}`,
        type: String(payload.eventType ?? "event"),
        message: String(payload.message ?? ""),
        severity: String(payload.severity ?? "info"),
        timestamp: lastMessage.timestamp,
      };
      setWsEvents(prev => [evt, ...prev].slice(0, 50));
    } else if (lastMessage.type === "escalation") {
      const payload = lastMessage.payload;
      const evt: LocalEvent = {
        id: `ws-esc-${Date.now()}`,
        type: "escalation",
        message: `Agent escalated on ${String(payload.building ?? "building")} → ${String(payload.provider ?? "AI")}${payload.fromCache ? " (cached)" : ""}`,
        severity: "warning",
        timestamp: lastMessage.timestamp,
      };
      setWsEvents(prev => [evt, ...prev].slice(0, 50));
    } else if (lastMessage.type === "bug_found") {
      const payload = lastMessage.payload;
      const evt: LocalEvent = {
        id: `ws-bug-${Date.now()}`,
        type: "bug_found",
        message: String(payload.message ?? `Bug found in ${payload.buildingId}`),
        severity: "critical",
        buildingName: String(payload.buildingId ?? ""),
        timestamp: lastMessage.timestamp,
      };
      setWsEvents(prev => [evt, ...prev].slice(0, 50));
    }
  }, [lastMessage]);

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden selection:bg-primary selection:text-primary-foreground">
      <button
        className="lg:hidden fixed top-4 right-4 z-50 p-2 glass-panel rounded-md text-primary"
        onClick={() => setSidebarOpen(!sidebarOpen)}
      >
        {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
      </button>

      <aside className={cn(
        "fixed inset-y-0 left-0 z-40 w-72 transform transition-transform duration-300 ease-in-out flex flex-col glass-panel border-r-primary/30",
        sidebarOpen ? "translate-x-0" : "-translate-x-full",
        "lg:relative lg:translate-x-0"
      )}>
        <div className="h-16 flex items-center px-6 border-b border-border/50 bg-background/50">
          <div className="flex items-center gap-3">
            <img src="/api/assets/logo" alt="Logo" className="w-8 h-8 rounded" />
            <span className="font-mono font-bold text-lg text-primary text-glow uppercase tracking-wider">Software City</span>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto py-6 px-4 space-y-2">
          <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-4 px-2">System Access</div>
          {NAV_ITEMS.map((item) => {
            const isActive = location === item.href;
            return (
              <Link key={item.href} href={item.href} className="block">
                <div className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 group font-mono text-sm cursor-pointer",
                  isActive
                    ? "bg-primary/20 text-primary border border-primary/50 shadow-[inset_0_0_10px_rgba(0,255,247,0.2)]"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}>
                  <item.icon size={18} className={cn(isActive && "text-primary")} />
                  {item.label}
                  {isActive && <ChevronRight size={14} className="ml-auto animate-pulse" />}
                </div>
              </Link>
            );
          })}

          <div className="mt-8">
            <div className="flex items-center gap-2 text-xs font-mono text-primary uppercase tracking-wider mb-2 px-2 border-b border-primary/20 pb-2">
              <Terminal size={14} />
              <span>City Event Stream</span>
              <div className="w-2 h-2 rounded-full bg-primary animate-ping ml-auto" />
            </div>
            <EventStream wsEvents={wsEvents} />
          </div>
        </nav>
      </aside>

      <main className="flex-1 flex flex-col h-full overflow-hidden relative z-0">
        {children}
      </main>
    </div>
  );
}

const EVENT_BORDER_COLORS: Record<string, string> = {
  bug_found: "border-l-2 border-l-destructive",
  test_passed: "border-l-2 border-l-success",
  escalation: "border-l-2 border-l-orange-400",
  agent_promoted: "border-l-2 border-l-primary",
  task_complete: "border-l-2 border-l-blue-400",
  building_collapse: "border-l-2 border-l-destructive bg-destructive/10",
};

const EVENT_TEXT_COLORS: Record<string, string> = {
  bug_found: "text-destructive",
  test_passed: "text-success",
  escalation: "text-orange-400",
  agent_promoted: "text-primary",
  task_complete: "text-blue-400",
  building_collapse: "text-destructive",
  info: "text-muted-foreground",
  warning: "text-warning",
  critical: "text-destructive",
};

function EventStream({ wsEvents }: { wsEvents: LocalEvent[] }) {
  const { data, isError } = useGetEventStream({ query: { refetchInterval: 5000 } });
  const scrollRef = useRef<HTMLDivElement>(null);

  const httpEvents: LocalEvent[] = (data?.events ?? []).map(evt => ({
    id: evt.id?.toString() ?? String(Math.random()),
    type: evt.type ?? "event",
    message: evt.message ?? "",
    severity: evt.severity ?? "info",
    buildingName: evt.buildingName ?? undefined,
    timestamp: evt.timestamp ?? new Date().toISOString(),
  }));

  const wsIds = new Set(wsEvents.map(e => e.id));
  const merged = [...wsEvents, ...httpEvents.filter(e => !wsIds.has(e.id))].slice(0, 50);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [merged.length]);

  if (isError && wsEvents.length === 0) {
    return <div className="p-4 text-xs text-destructive font-mono">Failed to connect to event stream.</div>;
  }

  return (
    <div ref={scrollRef} className="h-[400px] overflow-y-auto bg-black/40 rounded-lg border border-border/50 p-2 font-mono text-xs shadow-inner">
      {merged.length === 0 ? (
        <div className="text-muted-foreground p-2 opacity-50">Awaiting events...</div>
      ) : (
        <div className="space-y-1.5">
          {merged.map((evt) => {
            const typeKey = evt.type.toLowerCase();
            const borderClass = EVENT_BORDER_COLORS[typeKey] ?? "";
            const textClass = EVENT_TEXT_COLORS[typeKey] ?? EVENT_TEXT_COLORS[evt.severity] ?? "text-muted-foreground";

            return (
              <div key={evt.id} className={cn("flex flex-col gap-1 pb-2 last:border-0 pl-2", borderClass)}>
                <div className="flex justify-between items-center opacity-60 text-[10px]">
                  <span>{format(new Date(evt.timestamp), "HH:mm:ss")}</span>
                  <span className="uppercase">[{evt.type}]</span>
                </div>
                <div className={cn("break-words", textClass)}>
                  {">"} {evt.message}
                </div>
                {evt.buildingName && (
                  <div className="text-[10px] text-primary/70">Loc: {evt.buildingName}</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
