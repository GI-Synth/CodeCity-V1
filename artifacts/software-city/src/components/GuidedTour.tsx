import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, ChevronRight, ChevronLeft } from "lucide-react";

const TOUR_DONE_KEY = "sc_tour_done";

interface TourStep {
  id: string;
  title: string;
  body: string;
  selector?: string;
  position?: "top" | "bottom" | "left" | "right";
}

const STEPS: TourStep[] = [
  {
    id: "hud",
    title: "City Health Dashboard",
    body: "The HUD shows real-time city health, code quality season, active agent count, and WebSocket connection status. Health drops when bugs accumulate.",
    selector: "[data-tour='hud']",
    position: "bottom",
  },
  {
    id: "city-map",
    title: "The City Map",
    body: "Each colored block is a source file. Size reflects lines of code, color reflects file type. Click any building to inspect it. Fires 🔥 mean active bugs. Coverage bars show test coverage.",
    selector: "[data-tour='city-map']",
    position: "top",
  },
  {
    id: "share-btn",
    title: "Share & Export",
    body: "Share a snapshot of your city with your team. The link is read-only and shows the city exactly as it looks right now.",
    selector: "[data-tour='share-btn']",
    position: "bottom",
  },
  {
    id: "sidebar",
    title: "Navigation",
    body: "Use the sidebar to switch between City View, Agents, Knowledge Library, and the Leaderboard. The Event Stream logs every bug found and agent action in real time.",
    selector: "[data-tour='sidebar']",
    position: "right",
  },
];

interface SpotlightBox {
  top: number;
  left: number;
  width: number;
  height: number;
}

function getSpotlight(selector?: string): SpotlightBox | null {
  if (!selector) return null;
  const el = document.querySelector(selector);
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  return {
    top: rect.top - 8,
    left: rect.left - 8,
    width: rect.width + 16,
    height: rect.height + 16,
  };
}

function getTooltipStyle(box: SpotlightBox | null, position?: string): React.CSSProperties {
  if (!box) {
    return { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
  }

  const PADDING = 16;
  if (position === "bottom") {
    return {
      top: box.top + box.height + PADDING,
      left: Math.max(PADDING, box.left),
    };
  }
  if (position === "top") {
    return {
      top: Math.max(PADDING, box.top - 160),
      left: Math.max(PADDING, box.left),
    };
  }
  if (position === "right") {
    return {
      top: box.top,
      left: box.left + box.width + PADDING,
    };
  }
  return {
    top: box.top,
    left: Math.max(PADDING, box.left - 320 - PADDING),
  };
}

export function GuidedTour({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [spotlight, setSpotlight] = useState<SpotlightBox | null>(null);

  const current = STEPS[step];

  useEffect(() => {
    const box = getSpotlight(current?.selector);
    setSpotlight(box);
    if (box && current?.selector) {
      const el = document.querySelector(current.selector);
      el?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    }
  }, [step, current?.selector]);

  const handleDone = useCallback(() => {
    localStorage.setItem(TOUR_DONE_KEY, "1");
    onDone();
  }, [onDone]);

  const handleNext = () => {
    if (step < STEPS.length - 1) setStep(s => s + 1);
    else handleDone();
  };

  const handlePrev = () => setStep(s => Math.max(0, s - 1));

  const tooltipStyle = getTooltipStyle(spotlight, current?.position);

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[9999] pointer-events-none">
        {/* Dark overlay with spotlight cutout */}
        <svg className="absolute inset-0 w-full h-full pointer-events-auto" onClick={handleDone}>
          <defs>
            <mask id="tour-spotlight-mask">
              <rect width="100%" height="100%" fill="white" />
              {spotlight && (
                <rect
                  x={spotlight.left}
                  y={spotlight.top}
                  width={spotlight.width}
                  height={spotlight.height}
                  rx="8"
                  fill="black"
                />
              )}
            </mask>
          </defs>
          <rect width="100%" height="100%" fill="rgba(0,0,0,0.7)" mask="url(#tour-spotlight-mask)" />
        </svg>

        {/* Spotlight border glow */}
        {spotlight && (
          <motion.div
            key={step}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            className="absolute pointer-events-none rounded-lg border-2 border-primary shadow-[0_0_20px_rgba(0,255,247,0.5)]"
            style={{
              top: spotlight.top,
              left: spotlight.left,
              width: spotlight.width,
              height: spotlight.height,
            }}
          />
        )}

        {/* Tooltip card */}
        <motion.div
          key={`tooltip-${step}`}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          className="absolute pointer-events-auto w-80 glass-panel border border-primary/50 rounded-xl p-5 shadow-2xl"
          style={tooltipStyle}
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-mono text-primary uppercase tracking-widest">
              Step {step + 1} / {STEPS.length}
            </span>
            <button onClick={handleDone} className="text-muted-foreground hover:text-foreground transition-colors">
              <X size={14} />
            </button>
          </div>

          <h3 className="font-mono font-bold text-foreground text-base mb-2">{current?.title}</h3>
          <p className="text-sm font-mono text-muted-foreground leading-relaxed">{current?.body}</p>

          {/* Progress dots */}
          <div className="flex items-center gap-1.5 mt-4">
            {STEPS.map((_, i) => (
              <button
                key={i}
                onClick={() => setStep(i)}
                className={`rounded-full transition-all ${i === step ? "w-4 h-1.5 bg-primary" : "w-1.5 h-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/50"}`}
              />
            ))}
          </div>

          <div className="flex items-center justify-between mt-4">
            <button
              onClick={handlePrev}
              disabled={step === 0}
              className="flex items-center gap-1.5 text-xs font-mono text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft size={14} /> Prev
            </button>
            <button
              onClick={handleNext}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-primary text-black text-xs font-mono font-bold hover:bg-primary/80 transition-colors"
            >
              {step === STEPS.length - 1 ? "Done" : "Next"} <ChevronRight size={14} />
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

export function useTour() {
  const [showTour, setShowTour] = useState(false);

  useEffect(() => {
    const done = localStorage.getItem(TOUR_DONE_KEY);
    if (!done) {
      const t = setTimeout(() => setShowTour(true), 1200);
      return () => clearTimeout(t);
    }
    return undefined;
  }, []);

  return {
    showTour,
    startTour: () => setShowTour(true),
    endTour: () => setShowTour(false),
  };
}
