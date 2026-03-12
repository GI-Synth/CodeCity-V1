import { Link, useLocation } from "wouter";
import { Activity, Building2, Bot, BookOpen, ChevronRight, Terminal, Menu, X } from "lucide-react";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { useGetEventStream } from "@workspace/api-client-react";
import { format } from "date-fns";

const NAV_ITEMS = [
  { href: "/city", icon: Building2, label: "City View" },
  { href: "/agents", icon: Bot, label: "Agents Dashboard" },
  { href: "/knowledge", icon: BookOpen, label: "Knowledge Base" },
];

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden selection:bg-primary selection:text-primary-foreground">
      {/* Mobile sidebar toggle */}
      <button 
        className="lg:hidden fixed top-4 right-4 z-50 p-2 glass-panel rounded-md text-primary"
        onClick={() => setSidebarOpen(!sidebarOpen)}
      >
        {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
      </button>

      {/* Sidebar */}
      <aside 
        className={cn(
          "fixed inset-y-0 left-0 z-40 w-72 transform transition-transform duration-300 ease-in-out flex flex-col glass-panel border-r-primary/30",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
          "lg:relative lg:translate-x-0"
        )}
      >
        {/* Brand */}
        <div className="h-16 flex items-center px-6 border-b border-border/50 bg-background/50">
          <div className="flex items-center gap-3">
            <img src={`${import.meta.env.BASE_URL}images/logo.png`} alt="Logo" className="w-8 h-8 rounded animate-pulse" />
            <span className="font-mono font-bold text-lg text-primary text-glow uppercase tracking-wider">Software City</span>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-6 px-4 space-y-2">
          <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-4 px-2">System Access</div>
          {NAV_ITEMS.map((item) => {
            const isActive = location === item.href;
            return (
              <Link key={item.href} href={item.href} className="block">
                <div
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 group font-mono text-sm cursor-pointer",
                    isActive 
                      ? "bg-primary/20 text-primary border border-primary/50 shadow-[inset_0_0_10px_rgba(0,255,247,0.2)]" 
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  )}
                >
                  <item.icon size={18} className={cn(isActive && "text-primary")} />
                  {item.label}
                  {isActive && <ChevronRight size={14} className="ml-auto animate-pulse" />}
                </div>
              </Link>
            );
          })}

          {/* Event Stream Terminal */}
          <div className="mt-8">
            <div className="flex items-center gap-2 text-xs font-mono text-primary uppercase tracking-wider mb-2 px-2 border-b border-primary/20 pb-2">
              <Terminal size={14} />
              <span>City Event Stream</span>
              <div className="w-2 h-2 rounded-full bg-primary animate-ping ml-auto" />
            </div>
            <EventStream />
          </div>
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-full overflow-hidden relative z-0">
        {children}
      </main>
    </div>
  );
}

function EventStream() {
  const { data, isError } = useGetEventStream({
    query: { refetchInterval: 2000 }
  });

  if (isError) {
    return <div className="p-4 text-xs text-destructive font-mono">Failed to connect to event stream.</div>;
  }

  const events = data?.events || [];

  return (
    <div className="h-[400px] overflow-y-auto bg-black/40 rounded-lg border border-border/50 p-2 font-mono text-xs shadow-inner">
      {events.length === 0 ? (
        <div className="text-muted-foreground p-2 opacity-50">Awaiting events...</div>
      ) : (
        <div className="space-y-2">
          {events.map((evt) => {
            let color = "text-muted-foreground";
            if (evt.severity === "error" || evt.severity === "critical") color = "text-destructive";
            if (evt.severity === "warning") color = "text-warning";
            if (evt.type === "knowledge_hit" || evt.type === "test_passed") color = "text-success";
            
            return (
              <div key={evt.id} className="flex flex-col gap-1 border-b border-border/20 pb-2 last:border-0">
                <div className="flex justify-between items-center opacity-60 text-[10px]">
                  <span>{format(new Date(evt.timestamp), "HH:mm:ss")}</span>
                  <span className="uppercase">[{evt.type}]</span>
                </div>
                <div className={cn("break-words", color)}>
                  {'>'} {evt.message}
                </div>
                {evt.buildingName && (
                  <div className="text-[10px] text-primary/70">
                    Loc: {evt.buildingName}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
