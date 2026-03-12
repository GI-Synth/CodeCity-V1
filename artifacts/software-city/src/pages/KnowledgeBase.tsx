import { useState, useMemo } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useGetKnowledgeStats, useGetKnowledgeEntries } from "@workspace/api-client-react";
import { Brain, DatabaseZap, ShieldAlert, BookOpen, Search, X, Download, Trash2, Star, ArrowUpDown, ChevronLeft, ChevronRight } from "lucide-react";
import { format } from "date-fns";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 20;

type SortKey = "createdAt" | "useCount" | "qualityScore" | "confidence";
type SortDir = "asc" | "desc";

export function KnowledgeBase() {
  const { toast } = useToast();
  const { data: stats, refetch: refetchStats } = useGetKnowledgeStats({ query: { refetchInterval: 10000 } });
  const { data: entriesData, refetch: refetchEntries } = useGetKnowledgeEntries({ query: { refetchInterval: 10000 } });
  const [search, setSearch] = useState("");
  const [confidenceFilter, setConfidenceFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("createdAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
    setPage(1);
  };

  const filteredEntries = useMemo(() => {
    const entries = entriesData?.entries ?? [];
    const q = search.toLowerCase();
    const filtered = entries.filter(e => {
      const matchSearch = !q ||
        e.question?.toLowerCase().includes(q) ||
        e.problemType?.toLowerCase().includes(q) ||
        e.language?.toLowerCase().includes(q);
      const matchConf = confidenceFilter === "all" || e.confidence === confidenceFilter;
      return matchSearch && matchConf;
    });

    filtered.sort((a, b) => {
      let av: any, bv: any;
      if (sortKey === "createdAt") {
        av = new Date(a.createdAt).getTime();
        bv = new Date(b.createdAt).getTime();
      } else if (sortKey === "useCount") {
        av = a.useCount ?? 0;
        bv = b.useCount ?? 0;
      } else if (sortKey === "qualityScore") {
        av = (a as any).qualityScore ?? 0;
        bv = (b as any).qualityScore ?? 0;
      } else {
        const confOrder = { high: 3, medium: 2, low: 1 };
        av = confOrder[a.confidence as keyof typeof confOrder] ?? 0;
        bv = confOrder[b.confidence as keyof typeof confOrder] ?? 0;
      }
      return sortDir === "asc" ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
    });

    return filtered;
  }, [entriesData?.entries, search, confidenceFilter, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filteredEntries.length / PAGE_SIZE));
  const pageEntries = filteredEntries.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const handleDelete = async (id: number | string) => {
    try {
      const res = await fetch(`/api/knowledge/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      toast({ title: "Entry deleted" });
      refetchEntries();
      refetchStats();
    } catch {
      toast({ title: "Delete failed", variant: "destructive" });
    }
  };

  const handleExport = () => {
    const link = document.createElement("a");
    link.href = "/api/knowledge/export";
    link.download = `knowledge-base-${Date.now()}.json`;
    link.click();
  };

  const SortButton = ({ label, sk }: { label: string; sk: SortKey }) => (
    <button
      onClick={() => handleSort(sk)}
      className={cn(
        "flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors font-mono text-xs",
        sortKey === sk && "text-primary"
      )}
    >
      {label}
      <ArrowUpDown size={10} className={sortKey === sk ? "text-primary" : ""} />
    </button>
  );

  return (
    <AppLayout>
      <div className="p-8 h-full overflow-y-auto max-w-7xl mx-auto w-full">
        <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-mono font-bold text-secondary text-glow mb-2 flex items-center gap-3">
              <Brain className="text-secondary" /> Knowledge Library
            </h1>
            <p className="text-muted-foreground font-mono text-sm">
              The collective memory of all agents. Escalations are saved here to improve future performance.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={handleExport} className="font-mono border-secondary/30 text-secondary hover:bg-secondary/10">
            <Download size={13} className="mr-1.5" /> Export JSON
          </Button>
        </div>

        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
            <StatCard title="Total Entries" value={stats.totalEntries} icon={BookOpen} color="text-primary" />
            <StatCard title="Cache Hits" value={stats.totalCacheHits} icon={DatabaseZap} color="text-success" />
            <StatCard title="Escalation Rate" value={`${Math.round(stats.escalationRate * 100)}%`} icon={ShieldAlert} color="text-warning" />
            <StatCard title="Avg Bugs/Entry" value={stats.avgBugsPerEntry.toFixed(2)} icon={Brain} color="text-secondary" />
          </div>
        )}

        <div className="glass-panel rounded-xl overflow-hidden border border-border/50">
          <div className="p-4 border-b border-border/50 bg-black/40 flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-mono text-lg font-bold text-foreground">Agent Learnings</h3>
            <div className="flex items-center gap-3 flex-wrap">
              {/* Confidence filter */}
              <div className="flex gap-1">
                {["all", "high", "medium", "low"].map(level => (
                  <button
                    key={level}
                    onClick={() => { setConfidenceFilter(level); setPage(1); }}
                    className={`px-2 py-1 rounded text-[11px] font-mono uppercase tracking-wider transition-colors ${
                      confidenceFilter === level
                        ? level === "high" ? "bg-success/20 text-success border border-success/50"
                          : level === "medium" ? "bg-warning/20 text-warning border border-warning/50"
                          : level === "low" ? "bg-destructive/20 text-destructive border border-destructive/50"
                          : "bg-primary/20 text-primary border border-primary/50"
                        : "text-muted-foreground hover:text-foreground border border-transparent"
                    }`}
                  >
                    {level}
                  </button>
                ))}
              </div>
              {/* Search */}
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search patterns..."
                  value={search}
                  onChange={e => { setSearch(e.target.value); setPage(1); }}
                  className="pl-8 h-8 w-52 bg-black/50 border-border/50 focus-visible:ring-primary font-mono text-xs text-foreground placeholder:text-muted-foreground/50"
                />
                {search && (
                  <button
                    onClick={() => setSearch("")}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Results count + pagination */}
          <div className="px-4 py-2 bg-black/20 border-b border-border/30 text-xs font-mono text-muted-foreground flex items-center justify-between">
            <span>
              {filteredEntries.length} entr{filteredEntries.length === 1 ? "y" : "ies"}
              {(search || confidenceFilter !== "all") && ` (filtered from ${entriesData?.entries?.length ?? 0})`}
            </span>
            {totalPages > 1 && (
              <div className="flex items-center gap-2">
                <button
                  disabled={page <= 1}
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  className="disabled:opacity-30 hover:text-foreground transition-colors"
                >
                  <ChevronLeft size={14} />
                </button>
                <span>Page {page} / {totalPages}</span>
                <button
                  disabled={page >= totalPages}
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  className="disabled:opacity-30 hover:text-foreground transition-colors"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            )}
          </div>

          <Table>
            <TableHeader className="bg-black/60 font-mono">
              <TableRow className="border-border/30 hover:bg-transparent">
                <TableHead className="text-muted-foreground">Pattern</TableHead>
                <TableHead className="text-muted-foreground">Language</TableHead>
                <TableHead className="text-muted-foreground max-w-[280px]">Question</TableHead>
                <TableHead className="text-muted-foreground"><SortButton label="Confidence" sk="confidence" /></TableHead>
                <TableHead className="text-muted-foreground text-right"><SortButton label="Quality" sk="qualityScore" /></TableHead>
                <TableHead className="text-muted-foreground text-right"><SortButton label="Uses" sk="useCount" /></TableHead>
                <TableHead className="text-muted-foreground text-right"><SortButton label="Date" sk="createdAt" /></TableHead>
                <TableHead className="text-muted-foreground w-8" />
              </TableRow>
            </TableHeader>
            <TableBody className="font-mono text-sm">
              {pageEntries.map(entry => {
                const qualityScore = (entry as any).qualityScore ?? null;
                return (
                  <TableRow key={entry.id} className="border-border/20 hover:bg-primary/5 transition-colors group">
                    <TableCell className="font-medium text-secondary">{entry.problemType}</TableCell>
                    <TableCell className="text-foreground/80">{entry.language}</TableCell>
                    <TableCell className="max-w-[280px] text-muted-foreground group-hover:text-foreground transition-colors" title={entry.question}>
                      <span className="line-clamp-2 leading-snug">{entry.question}</span>
                    </TableCell>
                    <TableCell>
                      <span className={`px-2 py-1 rounded text-xs ${
                        entry.confidence === 'high' ? 'bg-success/20 text-success' :
                        entry.confidence === 'medium' ? 'bg-warning/20 text-warning' :
                        'bg-destructive/20 text-destructive'
                      }`}>
                        {entry.confidence}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      {qualityScore !== null ? (
                        <QualityStars score={qualityScore} />
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-bold text-primary">{entry.useCount}</TableCell>
                    <TableCell className="text-right text-muted-foreground text-xs">
                      {format(new Date(entry.createdAt as unknown as string), "MMM d, HH:mm")}
                    </TableCell>
                    <TableCell>
                      <button
                        onClick={() => handleDelete(entry.id)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-red-400"
                        title="Delete entry"
                      >
                        <Trash2 size={13} />
                      </button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {pageEntries.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="h-24 text-center text-muted-foreground font-mono">
                    {search || confidenceFilter !== "all"
                      ? `No entries match "${search || confidenceFilter}".`
                      : "No entries in knowledge base yet."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </AppLayout>
  );
}

function QualityStars({ score }: { score: number }) {
  const filled = Math.round(score * 5);
  return (
    <div className="flex items-center justify-end gap-0.5" title={`Quality: ${(score * 100).toFixed(0)}%`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          size={10}
          className={i < filled ? "text-yellow-400 fill-yellow-400" : "text-muted-foreground"}
        />
      ))}
    </div>
  );
}

function StatCard({ title, value, icon: Icon, color }: any) {
  return (
    <div className="glass-card p-6 rounded-xl flex items-center justify-between group">
      <div>
        <div className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-2">{title}</div>
        <div className="text-3xl font-mono font-bold text-foreground group-hover:text-glow transition-all">{value}</div>
      </div>
      <div className={`p-4 rounded-full bg-black/40 border border-border/50 ${color}`}>
        <Icon size={24} />
      </div>
    </div>
  );
}
