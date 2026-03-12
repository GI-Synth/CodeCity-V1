import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useLoadRepo, useLoadDemoRepo } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Github, Play, Terminal, ChevronDown, ChevronUp,
  KeyRound, ExternalLink, FolderOpen, Eye, Save, X, Clock, Zap,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";

const LS_REPO = "sc_saved_repo_url";
const LS_TOKEN = "sc_saved_github_token";
const LS_LOCAL = "sc_saved_local_path";

interface RepoListItem {
  id: number;
  slug: string;
  repoName: string;
  repoUrl: string;
  healthScore: number;
  season: string;
  isActive: boolean;
  loadedAt: string;
}

const SEASON_ICONS: Record<string, string> = {
  summer: "☀️",
  spring: "🌱",
  autumn: "🍂",
  winter: "❄️",
};

function healthColor(score: number) {
  if (score >= 80) return "text-green-400";
  if (score >= 50) return "text-yellow-400";
  return "text-red-400";
}

export function Landing() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [repoUrl, setRepoUrl] = useState(() => localStorage.getItem(LS_REPO) ?? "");
  const [githubToken, setGithubToken] = useState(() => localStorage.getItem(LS_TOKEN) ?? "");
  const [showAdvanced, setShowAdvanced] = useState(() => !!localStorage.getItem(LS_TOKEN));
  const [localPath, setLocalPath] = useState(() => localStorage.getItem(LS_LOCAL) ?? "");
  const [watchStatus, setWatchStatus] = useState<"idle" | "watching">("idle");
  const [savedIndicator, setSavedIndicator] = useState(false);

  const hasSaved = !!(localStorage.getItem(LS_REPO) || localStorage.getItem(LS_TOKEN));

  const { data: repoListData, refetch: refetchRepos } = useQuery<{ repos: RepoListItem[] }>({
    queryKey: ["repo-list"],
    queryFn: () => fetch("/api/repo/list").then(r => r.json()),
  });

  const recentRepos = repoListData?.repos ?? [];

  const persist = (url: string, token: string, local: string) => {
    if (url) localStorage.setItem(LS_REPO, url);
    else localStorage.removeItem(LS_REPO);
    if (token) localStorage.setItem(LS_TOKEN, token);
    else localStorage.removeItem(LS_TOKEN);
    if (local) localStorage.setItem(LS_LOCAL, local);
    else localStorage.removeItem(LS_LOCAL);
  };

  const handleForget = () => {
    localStorage.removeItem(LS_REPO);
    localStorage.removeItem(LS_TOKEN);
    localStorage.removeItem(LS_LOCAL);
    setRepoUrl("");
    setGithubToken("");
    setLocalPath("");
    toast({ title: "Saved credentials cleared" });
  };

  const loadMutation = useLoadRepo({
    mutation: {
      onSuccess: () => {
        persist(repoUrl, githubToken, localPath);
        setSavedIndicator(true);
        setTimeout(() => setSavedIndicator(false), 2500);
        refetchRepos();
        setLocation("/city");
      },
      onError: (err: any) => toast({
        title: "Failed to load repository",
        description: err.message || "Could not fetch repo. Check the URL and token.",
        variant: "destructive",
      }),
    },
  });

  const demoMutation = useLoadDemoRepo({
    mutation: {
      onSuccess: () => setLocation("/city"),
      onError: () => toast({ title: "Error", description: "Failed to load demo", variant: "destructive" }),
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!repoUrl) return;
    loadMutation.mutate({
      data: {
        repoUrl,
        ...(githubToken ? { githubToken } : {}),
      },
    });
  };

  const handleQuickLoad = (repo: RepoListItem) => {
    setRepoUrl(repo.repoUrl ?? "");
    loadMutation.mutate({
      data: {
        repoUrl: repo.repoUrl ?? "",
        ...(githubToken ? { githubToken } : {}),
      },
    });
  };

  const handleWatchLocal = async () => {
    if (!localPath) return;
    try {
      const res = await fetch("/api/repo/watch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ localPath }),
      });
      if (!res.ok) throw new Error("Watch failed");
      persist(repoUrl, githubToken, localPath);
      setWatchStatus("watching");
      toast({ title: "Watching local folder", description: localPath });
      setLocation("/city");
    } catch {
      toast({ title: "Failed to watch folder", variant: "destructive" });
    }
  };

  const isLoading = loadMutation.isPending;

  return (
    <div className="min-h-screen w-full bg-background relative flex items-center justify-center overflow-hidden">
      <div className="absolute inset-0 z-0">
        <img
          src="/api/assets/hero"
          alt="Cyberpunk City"
          className="w-full h-full object-cover opacity-30 object-center"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-background/80 via-background/60 to-background" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)]" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        className="z-10 w-full max-w-2xl px-6"
      >
        <div className="text-center mb-10">
          <motion.div
            initial={{ scale: 0.8 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", bounce: 0.5, delay: 0.2 }}
            className="w-24 h-24 mx-auto mb-6 relative"
          >
            <div className="absolute inset-0 bg-primary/20 blur-xl rounded-full" />
            <img src="/api/assets/logo" alt="Logo" className="w-full h-full relative z-10 rounded-xl" />
          </motion.div>

          <h1 className="text-5xl md:text-7xl font-mono font-bold text-white mb-4 tracking-tighter text-glow">
            SOFTWARE <span className="text-primary">CITY</span>
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground font-mono max-w-xl mx-auto leading-relaxed">
            A living, breathing visualization of your codebase.
            Watch AI agents patrol your architecture, find bugs, and maintain city health.
          </p>
        </div>

        <div className="glass-panel p-8 rounded-2xl">
          {/* Recent repos */}
          {recentRepos.length > 0 && (
            <div className="mb-6">
              <div className="text-xs font-mono text-muted-foreground uppercase tracking-widest flex items-center gap-2 mb-3">
                <Clock size={12} /> Recent Cities
              </div>
              <div className="space-y-2">
                {recentRepos.slice(0, 3).map(repo => (
                  <button
                    key={repo.id}
                    onClick={() => handleQuickLoad(repo)}
                    disabled={isLoading}
                    className={cn(
                      "w-full flex items-center justify-between gap-3 px-4 py-3 rounded-lg border transition-all duration-200 text-left group",
                      repo.isActive
                        ? "border-primary/50 bg-primary/8 hover:bg-primary/15"
                        : "border-border/30 bg-black/30 hover:border-primary/30 hover:bg-black/50"
                    )}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-base shrink-0">{SEASON_ICONS[repo.season] ?? "🏙️"}</span>
                      <div className="min-w-0">
                        <div className="font-mono font-bold text-sm text-foreground truncate group-hover:text-primary transition-colors">
                          {repo.repoName || repo.slug}
                        </div>
                        <div className="text-[11px] font-mono text-muted-foreground truncate">
                          {repo.repoUrl}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0 text-xs font-mono">
                      <span className={healthColor(repo.healthScore ?? 0)}>
                        {repo.healthScore ?? 0}%
                      </span>
                      {repo.isActive && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] bg-primary/20 text-primary border border-primary/30 uppercase tracking-widest">
                          active
                        </span>
                      )}
                      <Zap size={12} className="text-muted-foreground group-hover:text-primary transition-colors" />
                    </div>
                  </button>
                ))}
              </div>

              <div className="relative flex items-center py-4">
                <div className="flex-grow border-t border-border/30" />
                <span className="flex-shrink-0 mx-4 text-muted-foreground font-mono text-xs uppercase">or load new</span>
                <div className="flex-grow border-t border-border/30" />
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-mono text-primary uppercase tracking-widest flex items-center gap-2">
                  <Terminal size={14} /> Initialize Repository
                </label>
                {hasSaved && (
                  <button
                    type="button"
                    onClick={handleForget}
                    className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground hover:text-red-400 transition-colors"
                  >
                    <X size={10} /> Forget saved
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                <div className="relative flex-1 group">
                  <Github className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground group-focus-within:text-primary transition-colors" size={20} />
                  <Input
                    placeholder="https://github.com/user/repo"
                    value={repoUrl}
                    onChange={(e) => setRepoUrl(e.target.value)}
                    className="pl-10 h-12 bg-black/50 border-primary/30 focus-visible:ring-primary font-mono text-sm text-white placeholder:text-muted-foreground/50"
                  />
                </div>
                <Button type="submit" size="lg" className="h-12 w-32 font-bold" disabled={isLoading || !repoUrl}>
                  {isLoading ? (
                    <span className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-white animate-bounce" style={{ animationDelay: "0ms" }} />
                      <span className="w-2 h-2 rounded-full bg-white animate-bounce" style={{ animationDelay: "150ms" }} />
                      <span className="w-2 h-2 rounded-full bg-white animate-bounce" style={{ animationDelay: "300ms" }} />
                    </span>
                  ) : savedIndicator ? (
                    <span className="flex items-center gap-1.5 text-green-300">
                      <Save size={13} /> Saved
                    </span>
                  ) : "LOAD CITY"}
                </Button>
              </div>

              {/* Auto-save notice */}
              <p className="text-[11px] font-mono text-muted-foreground/50 flex items-center gap-1.5">
                <Save size={10} />
                Repo URL and token are automatically saved in your browser for next time.
              </p>
            </div>

            <div>
              <button
                type="button"
                onClick={() => setShowAdvanced(v => !v)}
                className="flex items-center gap-2 text-xs font-mono text-muted-foreground hover:text-primary transition-colors"
              >
                {showAdvanced ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                {showAdvanced ? "Hide" : "Private repo?"} — GitHub token
                {localStorage.getItem(LS_TOKEN) && (
                  <span className="ml-1 px-1.5 py-0.5 rounded text-[9px] bg-green-500/20 text-green-400 border border-green-500/30 font-mono uppercase tracking-widest">
                    saved
                  </span>
                )}
              </button>

              <AnimatePresence>
                {showAdvanced && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="mt-3 p-4 rounded-lg border border-primary/20 bg-black/30 space-y-3">
                      <div className="space-y-1.5">
                        <label className="text-xs font-mono text-primary/80 uppercase tracking-widest flex items-center gap-2">
                          <KeyRound size={12} /> GitHub Personal Access Token
                        </label>
                        <div className="relative group">
                          <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground group-focus-within:text-primary transition-colors" size={16} />
                          <Input
                            type="password"
                            placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                            value={githubToken}
                            onChange={(e) => setGithubToken(e.target.value)}
                            className="pl-9 h-10 bg-black/50 border-primary/20 focus-visible:ring-primary font-mono text-sm text-white placeholder:text-muted-foreground/40"
                          />
                          {githubToken && (
                            <button
                              type="button"
                              onClick={() => setGithubToken("")}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-red-400 transition-colors"
                              title="Clear token"
                            >
                              <X size={13} />
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="text-[11px] font-mono text-muted-foreground/70 space-y-1 leading-relaxed">
                        <p>Your token is stored only in your browser's local storage — never sent anywhere except your own server.</p>
                        <p>
                          <a
                            href="https://github.com/settings/tokens/new?scopes=repo&description=SoftwareCity"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary/70 hover:text-primary underline flex items-center gap-1 w-fit"
                          >
                            <ExternalLink size={11} /> Generate a token (needs "repo" scope)
                          </a>
                        </p>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="relative flex items-center py-1">
              <div className="flex-grow border-t border-border/50"></div>
              <span className="flex-shrink-0 mx-4 text-muted-foreground font-mono text-xs uppercase">or</span>
              <div className="flex-grow border-t border-border/50"></div>
            </div>

            <Button
              type="button"
              variant="outline"
              className="w-full h-12 group hover:bg-primary/5 border-primary/30"
              onClick={() => demoMutation.mutate()}
              disabled={demoMutation.isPending}
            >
              <Play size={16} className="mr-2 text-primary group-hover:text-primary animate-pulse" />
              <span className="text-foreground">Run Demo Simulation</span>
            </Button>

            <div className="relative flex items-center py-1">
              <div className="flex-grow border-t border-border/50"></div>
              <span className="flex-shrink-0 mx-4 text-muted-foreground font-mono text-xs uppercase">or watch local</span>
              <div className="flex-grow border-t border-border/50"></div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-mono text-muted-foreground uppercase tracking-widest flex items-center gap-2">
                <FolderOpen size={14} /> Watch a Local Folder
              </label>
              <div className="flex gap-2">
                <Input
                  placeholder="C:\projects\myapp or /home/user/myapp"
                  value={localPath}
                  onChange={(e) => setLocalPath(e.target.value)}
                  className="flex-1 h-10 bg-black/50 border-border/30 font-mono text-xs text-white placeholder:text-muted-foreground/40"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-10 px-4 border-border/30"
                  onClick={handleWatchLocal}
                  disabled={!localPath || watchStatus === "watching"}
                >
                  <Eye size={14} className="mr-2" />
                  {watchStatus === "watching" ? "Watching" : "Watch"}
                </Button>
              </div>
              <p className="text-[11px] font-mono text-muted-foreground/50">
                Live re-analysis on file changes via WebSocket. Only works when the server has filesystem access to this path.
              </p>
            </div>
          </form>
        </div>

        <div className="mt-8 flex justify-center gap-8 text-xs font-mono text-muted-foreground/60">
          <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-success animate-pulse" /> Live Metrics</div>
          <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-warning animate-pulse" /> Auto-Scaling</div>
          <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-primary animate-pulse" /> AI Agents</div>
        </div>
      </motion.div>
    </div>
  );
}
