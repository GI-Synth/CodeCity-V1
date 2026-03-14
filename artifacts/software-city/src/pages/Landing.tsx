import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useLoadRepo } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Github, Terminal, ChevronDown, ChevronUp,
  KeyRound, ExternalLink, FolderOpen, Eye, Save, X, Clock, Zap,
  Building2, Bot, Search,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";

const LS_REPO = "sc_saved_repo_url";
const LS_LOCAL = "sc_saved_local_path";

interface RepoListItem {
  id: number;
  slug: string;
  repoName: string;
  repoUrl: string;
  githubTokenHint?: string | null;
  hasTokenOnFile?: boolean;
  healthScore: number;
  season: string;
  isActive: boolean;
  loadedAt: string;
}

interface GithubTokenStatus {
  tokenOnFile: boolean;
  tokenHint: string | null;
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

const HOW_IT_WORKS = [
  {
    icon: Building2,
    step: "01",
    title: "Paste a Repo URL",
    body: "Point Software City at any public GitHub repository — or a private one with a personal access token. You can also watch a local folder.",
    color: "text-primary",
    bg: "bg-primary/10",
    border: "border-primary/30",
  },
  {
    icon: Search,
    step: "02",
    title: "City Generates",
    body: "Our AI mapper scans every file and turns it into a building. Size = lines of code. Color = file type. Districts group related files. Coverage bars show test health.",
    color: "text-yellow-400",
    bg: "bg-yellow-400/10",
    border: "border-yellow-400/30",
  },
  {
    icon: Bot,
    step: "03",
    title: "Run Verifiable Checks",
    body: "Use agent tools and test execution to inspect files. The app surfaces stored results and event logs from real actions instead of synthetic city drama.",
    color: "text-orange-400",
    bg: "bg-orange-400/10",
    border: "border-orange-400/30",
  },
];

export function Landing() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [repoUrl, setRepoUrl] = useState(() => localStorage.getItem(LS_REPO) ?? "");
  const [githubToken, setGithubToken] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showTokenInput, setShowTokenInput] = useState(false);
  const [rememberGithubToken, setRememberGithubToken] = useState(true);
  const [localPath, setLocalPath] = useState(() => localStorage.getItem(LS_LOCAL) ?? "");
  const [watchStatus, setWatchStatus] = useState<"idle" | "watching">("idle");
  const [savedIndicator, setSavedIndicator] = useState(false);
  const [tokenSavedIndicator, setTokenSavedIndicator] = useState(false);
  const [showHowItWorks, setShowHowItWorks] = useState(false);

  const hasSaved = !!(localStorage.getItem(LS_REPO) || localStorage.getItem(LS_LOCAL));

  const { data: repoListData, refetch: refetchRepos } = useQuery<{ repos: RepoListItem[] }>({
    queryKey: ["repo-list"],
    queryFn: () => fetch("/api/repo/list").then(r => r.json()),
  });

  const recentRepos = repoListData?.repos ?? [];

  const { data: tokenStatus, refetch: refetchTokenStatus } = useQuery<GithubTokenStatus>({
    queryKey: ["github-token-status"],
    queryFn: async () => {
      const response = await fetch("/api/repo/token-status");
      if (!response.ok) throw new Error("Failed to fetch GitHub token status");
      return response.json() as Promise<GithubTokenStatus>;
    },
  });

  const tokenOnFile = Boolean(tokenStatus?.tokenOnFile);
  const shouldShowTokenInput = showTokenInput || !tokenOnFile;

  const persist = (url: string, local: string) => {
    if (url) localStorage.setItem(LS_REPO, url);
    else localStorage.removeItem(LS_REPO);
    if (local) localStorage.setItem(LS_LOCAL, local);
    else localStorage.removeItem(LS_LOCAL);
  };

  const handleForget = () => {
    localStorage.removeItem(LS_REPO);
    localStorage.removeItem(LS_LOCAL);
    setRepoUrl("");
    setGithubToken("");
    setLocalPath("");
    setShowTokenInput(false);
    toast({ title: "Saved browser fields cleared" });
  };

  const loadMutation = useLoadRepo({
    mutation: {
      onSuccess: (data: any) => {
        persist(repoUrl, localPath);
        setSavedIndicator(true);
        setTimeout(() => setSavedIndicator(false), 2500);

        if (data?.tokenSaved) {
          setTokenSavedIndicator(true);
          setTimeout(() => setTokenSavedIndicator(false), 2500);
        }

        setGithubToken("");
        setShowTokenInput(false);
        refetchRepos();
        refetchTokenStatus();
        setLocation("/city");
      },
      onError: async (err: any) => {
        if (githubToken.trim() && rememberGithubToken) {
          const statusResult = await refetchTokenStatus();
          if (statusResult.data?.tokenOnFile) {
            setTokenSavedIndicator(true);
            setTimeout(() => setTokenSavedIndicator(false), 2500);
            setGithubToken("");
            setShowTokenInput(false);
          }
        }

        toast({
          title: "Failed to load repository",
          description: err.message || "Could not fetch repo. Check the URL and token.",
          variant: "destructive",
        });
      },
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!repoUrl) return;

    const token = githubToken.trim();
    const payload: Record<string, unknown> = {
      repoUrl,
      rememberGithubToken,
    };
    if (token) payload.githubToken = token;

    loadMutation.mutate({
      data: payload as any,
    });
  };

  const handleQuickLoad = (repo: RepoListItem) => {
    setRepoUrl(repo.repoUrl ?? "");
    const token = githubToken.trim();
    const payload: Record<string, unknown> = {
      repoUrl: repo.repoUrl ?? "",
      rememberGithubToken,
    };
    if (token) payload.githubToken = token;

    loadMutation.mutate({
      data: payload as any,
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
      persist(repoUrl, localPath);
      setWatchStatus("watching");
      toast({ title: "Watching local folder", description: localPath });
      setLocation("/city");
    } catch {
      toast({ title: "Failed to watch folder", variant: "destructive" });
    }
  };

  const isLoading = loadMutation.isPending;

  return (
    <div className="min-h-screen w-full bg-background relative overflow-x-hidden">
      {/* Animated background */}
      <div className="absolute inset-0 z-0">
        <img
          src="/api/assets/hero"
          alt="Cyberpunk City"
          className="w-full h-full object-cover opacity-25 object-center"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-background/80 via-background/60 to-background" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)]" />
        {/* Floating particles */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          {[...Array(6)].map((_, i) => (
            <motion.div
              key={i}
              className="absolute w-1 h-1 rounded-full bg-primary/40"
              style={{ left: `${15 + i * 15}%`, top: `${20 + (i % 3) * 20}%` }}
              animate={{ y: [0, -30, 0], opacity: [0.4, 0.8, 0.4] }}
              transition={{ duration: 3 + i * 0.5, repeat: Infinity, delay: i * 0.4 }}
            />
          ))}
        </div>
      </div>

      <div className="relative z-10 flex flex-col items-center px-6 py-12">
        {/* Hero */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="text-center mb-12 max-w-3xl w-full"
        >
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
          <p className="text-lg md:text-xl text-muted-foreground font-mono max-w-xl mx-auto leading-relaxed mb-6">
            A living, breathing visualization of your codebase.
            Watch AI agents patrol your architecture, find bugs, and maintain city health.
          </p>

          <div className="flex justify-center gap-8 text-xs font-mono text-muted-foreground/60 mb-8">
            <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-success animate-pulse" /> Live Metrics</div>
            <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-warning animate-pulse" /> Auto-Scaling</div>
            <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-primary animate-pulse" /> AI Agents</div>
          </div>

          {/* How It Works toggle */}
          <button
            onClick={() => setShowHowItWorks(v => !v)}
            className="inline-flex items-center gap-2 text-xs font-mono text-primary/70 hover:text-primary transition-colors border border-primary/20 hover:border-primary/40 rounded-full px-4 py-1.5"
          >
            {showHowItWorks ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            {showHowItWorks ? "Hide" : "How it works"}
          </button>
        </motion.div>

        {/* How It Works Section */}
        <AnimatePresence>
          {showHowItWorks && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.35, ease: "easeInOut" }}
              className="w-full max-w-4xl mb-10 overflow-hidden"
            >
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {HOW_IT_WORKS.map((step, i) => (
                  <motion.div
                    key={step.step}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.1 }}
                    className={cn("glass-panel rounded-xl p-6 border", step.border)}
                  >
                    <div className="flex items-center gap-3 mb-4">
                      <div className={cn("p-2.5 rounded-lg border", step.bg, step.border)}>
                        <step.icon size={20} className={step.color} />
                      </div>
                      <span className={cn("font-mono text-3xl font-bold opacity-30", step.color)}>{step.step}</span>
                    </div>
                    <h3 className={cn("font-mono font-bold text-base mb-2", step.color)}>{step.title}</h3>
                    <p className="text-sm font-mono text-muted-foreground leading-relaxed">{step.body}</p>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Main Form Panel */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut", delay: 0.15 }}
          className="w-full max-w-2xl"
        >
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
                        {repo.hasTokenOnFile && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] bg-green-500/20 text-green-400 border border-green-500/30 uppercase tracking-widest">
                            token on file
                          </span>
                        )}
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

                <p className="text-[11px] font-mono text-muted-foreground/50 flex items-center gap-1.5">
                  <Save size={10} />
                  Repo URL and local watch path are saved in your browser for next time.
                </p>
                {tokenSavedIndicator && (
                  <p className="text-[11px] font-mono text-green-400">Token saved ✓</p>
                )}
              </div>

              <div>
                <button
                  type="button"
                  onClick={() => setShowAdvanced(v => !v)}
                  className="flex items-center gap-2 text-xs font-mono text-muted-foreground hover:text-primary transition-colors"
                >
                  {showAdvanced ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  {showAdvanced ? "Hide" : "Private repo?"} — GitHub token
                  {tokenOnFile && (
                    <span className="ml-1 px-1.5 py-0.5 rounded text-[9px] bg-green-500/20 text-green-400 border border-green-500/30 font-mono uppercase tracking-widest">
                      Token on file ✓
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
                        {!shouldShowTokenInput ? (
                          <div className="flex items-center justify-between gap-3 rounded border border-green-500/30 bg-green-500/10 px-3 py-2">
                            <div className="text-xs font-mono text-green-400">
                              Token on file ✓
                            </div>
                            <button
                              type="button"
                              onClick={() => setShowTokenInput(true)}
                              className="text-[11px] font-mono text-primary hover:text-primary/80 underline"
                            >
                              Update
                            </button>
                          </div>
                        ) : (
                          <>
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

                            <label className="flex items-center gap-2 text-xs font-mono text-muted-foreground">
                              <input
                                type="checkbox"
                                checked={rememberGithubToken}
                                onChange={(e) => setRememberGithubToken(e.target.checked)}
                                className="h-3.5 w-3.5 rounded border border-primary/40 bg-black/40"
                              />
                              Remember this token
                            </label>

                          </>
                        )}

                        <div className="text-[11px] font-mono text-muted-foreground/70 space-y-1 leading-relaxed">
                          <p>Your token is encrypted and saved by your own server. It is never shown back in full after saving.</p>
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
            <div className="flex items-center gap-2"><Bot size={12} className="text-primary" /> Agent-assisted inspection</div>
            <div className="flex items-center gap-2"><Building2 size={12} className="text-green-400" /> 1 file = 1 building</div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
