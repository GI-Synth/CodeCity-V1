import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { cn } from "@/lib/utils";
import { useState, useCallback } from "react";
import { Trash2, RotateCcw, AlertTriangle, CheckCircle } from "lucide-react";

type SettingsMap = Record<string, string>;

interface FieldRowProps {
  label: string;
  description?: string;
  children: React.ReactNode;
}

function FieldRow({ label, description, children }: FieldRowProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-mono text-foreground">{label}</div>
        {description && <div className="text-xs text-muted-foreground font-mono mt-0.5">{description}</div>}
      </div>
      <div className="sm:w-64 flex-shrink-0">{children}</div>
    </div>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="glass-panel rounded-xl border border-border/50 p-6 space-y-5">
      <div>
        <h2 className="text-sm font-mono font-bold text-primary uppercase tracking-wider">{title}</h2>
        {description && <p className="text-xs text-muted-foreground font-mono mt-1">{description}</p>}
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function SelectInput({
  value,
  options,
  onChange,
  savedKey,
  settingKey,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (val: string) => void;
  savedKey: string | null;
  settingKey: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <select
        className="flex-1 bg-background/80 border border-border/60 rounded-lg px-3 py-2 text-sm font-mono text-foreground focus:border-primary/60 focus:outline-none"
        value={value}
        onChange={e => onChange(e.target.value)}
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {savedKey === settingKey && <CheckCircle size={14} className="text-green-400 flex-shrink-0" />}
    </div>
  );
}

function ToggleInput({
  enabled,
  onChange,
  savedKey,
  settingKey,
}: {
  enabled: boolean;
  onChange: (val: boolean) => void;
  savedKey: string | null;
  settingKey: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => onChange(!enabled)}
        className={cn(
          "relative inline-flex h-6 w-11 items-center rounded-full transition-colors border",
          enabled ? "bg-primary/30 border-primary/60" : "bg-muted border-border/60"
        )}
      >
        <span
          className={cn(
            "inline-block h-4 w-4 transform rounded-full transition-transform",
            enabled ? "translate-x-6 bg-primary" : "translate-x-1 bg-muted-foreground"
          )}
        />
      </button>
      <span className="text-xs font-mono text-muted-foreground">{enabled ? "Enabled" : "Disabled"}</span>
      {savedKey === settingKey && <CheckCircle size={14} className="text-green-400" />}
    </div>
  );
}

function NumberInput({
  defaultValue,
  min,
  max,
  step,
  onSave,
  savedKey,
  settingKey,
}: {
  defaultValue: number;
  min?: number;
  max?: number;
  step?: number;
  onSave: (val: string) => void;
  savedKey: string | null;
  settingKey: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        className="flex-1 bg-background/80 border border-border/60 rounded-lg px-3 py-2 text-sm font-mono text-foreground focus:border-primary/60 focus:outline-none"
        defaultValue={defaultValue}
        min={min}
        max={max}
        step={step ?? 1}
        onBlur={e => onSave(e.target.value)}
        onKeyDown={e => e.key === "Enter" && onSave((e.target as HTMLInputElement).value)}
      />
      {savedKey === settingKey && <CheckCircle size={14} className="text-green-400 flex-shrink-0" />}
    </div>
  );
}

function TextAreaInput({
  defaultValue,
  onSave,
  savedKey,
  settingKey,
}: {
  defaultValue: string;
  onSave: (val: string) => void;
  savedKey: string | null;
  settingKey: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <textarea
        className="flex-1 bg-background/80 border border-border/60 rounded-lg px-3 py-2 text-xs font-mono text-foreground focus:border-primary/60 focus:outline-none resize-none h-20"
        defaultValue={defaultValue}
        onBlur={e => onSave(e.target.value)}
      />
      {savedKey === settingKey && <CheckCircle size={14} className="text-green-400 flex-shrink-0" />}
    </div>
  );
}

function TextInput({
  defaultValue,
  onSave,
  savedKey,
  settingKey,
  maxLength,
}: {
  defaultValue: string;
  onSave: (val: string) => void;
  savedKey: string | null;
  settingKey: string;
  maxLength?: number;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="text"
        className="flex-1 bg-background/80 border border-border/60 rounded-lg px-3 py-2 text-sm font-mono text-foreground focus:border-primary/60 focus:outline-none"
        defaultValue={defaultValue}
        maxLength={maxLength}
        onBlur={e => onSave(e.target.value)}
        onKeyDown={e => e.key === "Enter" && onSave((e.target as HTMLInputElement).value)}
      />
      {savedKey === settingKey && <CheckCircle size={14} className="text-green-400 flex-shrink-0" />}
    </div>
  );
}

const PROVIDER_OPTIONS = [
  { value: "groq", label: "Groq (fast, free)" },
  { value: "openai", label: "OpenAI GPT-4o" },
  { value: "anthropic", label: "Anthropic Claude" },
  { value: "ollama", label: "Ollama (local)" },
];

const THEME_OPTIONS = [
  { value: "dark", label: "Dark Cyberpunk (default)" },
  { value: "midnight", label: "Midnight Blue" },
  { value: "matrix", label: "Matrix Green" },
];

export function Settings() {
  const qc = useQueryClient();
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [danger, setDanger] = useState<"none" | "clearKb" | "resetSettings">("none");
  const [dangerConfirm, setDangerConfirm] = useState("");

  const { data: settings, isLoading } = useQuery<SettingsMap>({
    queryKey: ["settings"],
    queryFn: async () => {
      const res = await fetch("/api/settings");
      if (!res.ok) throw new Error("Failed to load settings");
      return res.json() as Promise<SettingsMap>;
    },
  });

  const mutation = useMutation({
    mutationFn: async ({ key, value }: { key: string; value: string }) => {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value }),
      });
      if (!res.ok) throw new Error("Failed to save setting");
      return res.json() as Promise<SettingsMap>;
    },
    onSuccess: (data) => {
      qc.setQueryData(["settings"], data);
    },
  });

  const saveSetting = useCallback(
    (key: string, value: string) => {
      mutation.mutate({ key, value }, {
        onSuccess: () => {
          setSavedKey(key);
          setTimeout(() => setSavedKey(prev => prev === key ? null : prev), 2000);
        },
      });
    },
    [mutation]
  );

  const get = (key: string, def: string) => settings?.[key] ?? def;

  async function handleClearKB() {
    if (dangerConfirm !== "CLEAR") return;
    await fetch("/api/knowledge/clear", { method: "DELETE" });
    setDanger("none");
    setDangerConfirm("");
  }

  async function handleResetSettings() {
    if (dangerConfirm !== "RESET") return;
    await fetch("/api/settings", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: "CLEAR_ALL" }),
    });
    void qc.invalidateQueries({ queryKey: ["settings"] });
    setDanger("none");
    setDangerConfirm("");
  }

  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-primary font-mono animate-pulse">Loading settings…</div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="flex-1 overflow-y-auto bg-background">
        <div className="max-w-3xl mx-auto p-6 space-y-6">
          <div>
            <h1 className="text-2xl font-mono font-bold text-primary text-glow">Settings</h1>
            <p className="text-sm text-muted-foreground font-mono mt-1">Configure AI agents, analysis parameters, and city behavior</p>
          </div>

          <Section title="AI Configuration" description="Control how AI agents escalate and communicate">
            <FieldRow label="Mayor Name" description="Name used by the mayor persona in chat responses">
              <TextInput
                settingKey="mayor_name"
                defaultValue={get("mayor_name", "Mayor")}
                maxLength={40}
                onSave={v => saveSetting("mayor_name", v.trim() || "Mayor")}
                savedKey={savedKey}
              />
            </FieldRow>
            <FieldRow label="Escalation Provider" description="AI provider used when agents escalate hard problems">
              <SelectInput
                settingKey="escalation_provider"
                value={get("escalation_provider", "groq")}
                options={PROVIDER_OPTIONS}
                onChange={v => saveSetting("escalation_provider", v)}
                savedKey={savedKey}
              />
            </FieldRow>
            <FieldRow label="Enable Escalations" description="Allow agents to call AI APIs on hard bugs. Disable to save credits.">
              <ToggleInput
                settingKey="escalation_enabled"
                enabled={get("escalation_enabled", "true") === "true"}
                onChange={v => saveSetting("escalation_enabled", v ? "true" : "false")}
                savedKey={savedKey}
              />
            </FieldRow>
            <FieldRow label="KB Similarity Threshold" description="Min similarity (0–1) to reuse a KB answer">
              <NumberInput
                settingKey="kb_similarity_threshold"
                defaultValue={Number(get("kb_similarity_threshold", "0.65"))}
                min={0} max={1} step={0.05}
                onSave={v => saveSetting("kb_similarity_threshold", v)}
                savedKey={savedKey}
              />
            </FieldRow>
            <FieldRow label="Test Timeout (ms)" description="How long agents wait before timing out">
              <NumberInput
                settingKey="test_timeout_ms"
                defaultValue={Number(get("test_timeout_ms", "15000"))}
                min={1000} max={120000} step={1000}
                onSave={v => saveSetting("test_timeout_ms", v)}
                savedKey={savedKey}
              />
            </FieldRow>
          </Section>

          <Section title="Agent Behavior" description="Control agent loop speed and concurrency">
            <FieldRow label="Agent Loop Interval (ms)" description="How often agents run their patrol cycle. Lower = faster but more CPU.">
              <NumberInput
                settingKey="agent_loop_interval_ms"
                defaultValue={Number(get("agent_loop_interval_ms", "8000"))}
                min={1000} max={60000} step={500}
                onSave={v => saveSetting("agent_loop_interval_ms", v)}
                savedKey={savedKey}
              />
            </FieldRow>
            <FieldRow label="Max Concurrent Agents" description="Maximum number of agents that can be spawned at once">
              <NumberInput
                settingKey="max_concurrent_agents"
                defaultValue={Number(get("max_concurrent_agents", "8"))}
                min={1} max={20}
                onSave={v => saveSetting("max_concurrent_agents", v)}
                savedKey={savedKey}
              />
            </FieldRow>
          </Section>

          <Section title="Analysis" description="Control which files agents patrol">
            <FieldRow label="Max File Size (KB)" description="Files larger than this are skipped">
              <NumberInput
                settingKey="max_file_size_kb"
                defaultValue={Number(get("max_file_size_kb", "500"))}
                min={10} max={10000} step={50}
                onSave={v => saveSetting("max_file_size_kb", v)}
                savedKey={savedKey}
              />
            </FieldRow>
            <FieldRow label="Ignore Patterns" description="Comma-separated patterns to exclude (e.g. node_modules,.git,dist)">
              <TextAreaInput
                settingKey="file_ignore_patterns"
                defaultValue={get("file_ignore_patterns", "node_modules,.git,dist")}
                onSave={v => saveSetting("file_ignore_patterns", v)}
                savedKey={savedKey}
              />
            </FieldRow>
          </Section>

          <Section title="Appearance" description="Visual preferences for the city interface">
            <FieldRow label="Theme">
              <SelectInput
                settingKey="theme"
                value={get("theme", "dark")}
                options={THEME_OPTIONS}
                onChange={v => saveSetting("theme", v)}
                savedKey={savedKey}
              />
            </FieldRow>
            <FieldRow label="Guided Tour Complete" description="Toggle off to replay the tour on next City View visit">
              <ToggleInput
                settingKey="tour_complete"
                enabled={get("tour_complete", "false") === "true"}
                onChange={v => saveSetting("tour_complete", v ? "true" : "false")}
                savedKey={savedKey}
              />
            </FieldRow>
          </Section>

          <Section title="Danger Zone" description="Irreversible actions — double-check before proceeding">
            <div className="space-y-3">
              <div className="flex items-center justify-between p-4 rounded-lg border border-red-500/20 bg-red-500/5">
                <div>
                  <div className="text-sm font-mono font-bold text-red-400">Clear Knowledge Base</div>
                  <div className="text-xs text-muted-foreground font-mono mt-0.5">Deletes all agent learnings. Cannot be undone.</div>
                </div>
                <button
                  onClick={() => { setDanger("clearKb"); setDangerConfirm(""); }}
                  className="flex items-center gap-2 px-3 py-2 text-xs font-mono rounded-lg border border-red-500/40 text-red-400 hover:bg-red-500/10 transition-colors"
                >
                  <Trash2 size={13} /> Clear KB
                </button>
              </div>
              {danger === "clearKb" && (
                <div className="p-4 rounded-lg border border-red-500/40 bg-red-500/10 space-y-3">
                  <div className="flex items-center gap-2 text-red-400 text-sm font-mono font-bold">
                    <AlertTriangle size={14} /> Type CLEAR to confirm
                  </div>
                  <input
                    className="w-full bg-background border border-red-500/40 rounded px-3 py-2 text-sm font-mono text-red-400 focus:outline-none"
                    placeholder="Type CLEAR to confirm"
                    value={dangerConfirm}
                    onChange={e => setDangerConfirm(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => void handleClearKB()}
                      disabled={dangerConfirm !== "CLEAR"}
                      className="px-3 py-1.5 text-xs font-mono rounded border border-red-500/60 text-red-400 hover:bg-red-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >Confirm Clear</button>
                    <button onClick={() => setDanger("none")} className="px-3 py-1.5 text-xs font-mono rounded border border-border/60 text-muted-foreground hover:text-foreground transition-colors">Cancel</button>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between p-4 rounded-lg border border-orange-500/20 bg-orange-500/5">
                <div>
                  <div className="text-sm font-mono font-bold text-orange-400">Reset Settings</div>
                  <div className="text-xs text-muted-foreground font-mono mt-0.5">Restore all settings to factory defaults.</div>
                </div>
                <button
                  onClick={() => { setDanger("resetSettings"); setDangerConfirm(""); }}
                  className="flex items-center gap-2 px-3 py-2 text-xs font-mono rounded-lg border border-orange-500/40 text-orange-400 hover:bg-orange-500/10 transition-colors"
                >
                  <RotateCcw size={13} /> Reset
                </button>
              </div>
              {danger === "resetSettings" && (
                <div className="p-4 rounded-lg border border-orange-500/40 bg-orange-500/10 space-y-3">
                  <div className="flex items-center gap-2 text-orange-400 text-sm font-mono font-bold">
                    <AlertTriangle size={14} /> Type RESET to confirm
                  </div>
                  <input
                    className="w-full bg-background border border-orange-500/40 rounded px-3 py-2 text-sm font-mono text-orange-400 focus:outline-none"
                    placeholder="Type RESET to confirm"
                    value={dangerConfirm}
                    onChange={e => setDangerConfirm(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => void handleResetSettings()}
                      disabled={dangerConfirm !== "RESET"}
                      className="px-3 py-1.5 text-xs font-mono rounded border border-orange-500/60 text-orange-400 hover:bg-orange-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >Confirm Reset</button>
                    <button onClick={() => setDanger("none")} className="px-3 py-1.5 text-xs font-mono rounded border border-border/60 text-muted-foreground hover:text-foreground transition-colors">Cancel</button>
                  </div>
                </div>
              )}
            </div>
          </Section>
        </div>
      </div>
    </AppLayout>
  );
}
