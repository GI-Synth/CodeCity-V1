import { useState, useMemo } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useGetKnowledgeStats, useGetKnowledgeEntries } from "@workspace/api-client-react";
import { Brain, DatabaseZap, ShieldAlert, BookOpen, Search, X } from "lucide-react";
import { format } from "date-fns";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function KnowledgeBase() {
  const { data: stats } = useGetKnowledgeStats({ query: { refetchInterval: 10000 } });
  const { data: entriesData } = useGetKnowledgeEntries({ query: { refetchInterval: 10000 } });
  const [search, setSearch] = useState("");
  const [confidenceFilter, setConfidenceFilter] = useState<string>("all");

  const filteredEntries = useMemo(() => {
    const entries = entriesData?.entries ?? [];
    const q = search.toLowerCase();
    return entries.filter(e => {
      const matchSearch = !q ||
        e.question?.toLowerCase().includes(q) ||
        e.problemType?.toLowerCase().includes(q) ||
        e.language?.toLowerCase().includes(q);
      const matchConf = confidenceFilter === "all" || e.confidence === confidenceFilter;
      return matchSearch && matchConf;
    });
  }, [entriesData?.entries, search, confidenceFilter]);

  return (
    <AppLayout>
      <div className="p-8 h-full overflow-y-auto max-w-7xl mx-auto w-full">
        <div className="mb-8">
          <h1 className="text-3xl font-mono font-bold text-secondary text-glow mb-2 flex items-center gap-3">
            <Brain className="text-secondary" /> Knowledge Library
          </h1>
          <p className="text-muted-foreground font-mono text-sm">
            The collective memory of all agents. Escalations are saved here to improve future performance.
          </p>
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
            <div className="flex items-center gap-3">
              {/* Confidence filter */}
              <div className="flex gap-1">
                {["all", "high", "medium", "low"].map(level => (
                  <button
                    key={level}
                    onClick={() => setConfidenceFilter(level)}
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
                  onChange={e => setSearch(e.target.value)}
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

          {/* Results count */}
          {(search || confidenceFilter !== "all") && (
            <div className="px-4 py-2 bg-black/20 border-b border-border/30 text-xs font-mono text-muted-foreground">
              Showing {filteredEntries.length} of {entriesData?.entries?.length ?? 0} entries
            </div>
          )}

          <Table>
            <TableHeader className="bg-black/60 font-mono">
              <TableRow className="border-border/30 hover:bg-transparent">
                <TableHead className="text-muted-foreground">Pattern</TableHead>
                <TableHead className="text-muted-foreground">Language</TableHead>
                <TableHead className="text-muted-foreground max-w-[300px]">Question</TableHead>
                <TableHead className="text-muted-foreground">Confidence</TableHead>
                <TableHead className="text-muted-foreground text-right">Uses</TableHead>
                <TableHead className="text-muted-foreground text-right">Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="font-mono text-sm">
              {filteredEntries.map(entry => (
                <TableRow key={entry.id} className="border-border/20 hover:bg-primary/5 transition-colors group">
                  <TableCell className="font-medium text-secondary">{entry.problemType}</TableCell>
                  <TableCell className="text-foreground/80">{entry.language}</TableCell>
                  <TableCell className="max-w-[300px] text-muted-foreground group-hover:text-foreground transition-colors" title={entry.question}>
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
                  <TableCell className="text-right font-bold text-primary">{entry.useCount}</TableCell>
                  <TableCell className="text-right text-muted-foreground text-xs">
                    {format(new Date(entry.createdAt), "MMM d, HH:mm")}
                  </TableCell>
                </TableRow>
              ))}
              {filteredEntries.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-muted-foreground font-mono">
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
