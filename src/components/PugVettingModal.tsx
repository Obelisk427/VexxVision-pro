import { useState, useEffect } from 'react';
import type { PugVettingMetrics, RaiderIOBestRun, Region } from '../types';
import { fetchRunMetrics } from '../services/warcraftLogs';

interface PugVettingModalProps {
  run: RaiderIOBestRun;
  characterName: string;
  realm: string;
  region: Region;
  onClose: () => void;
}

interface MetricCard {
  key: keyof PugVettingMetrics;
  label: string;
  sublabel: string;
  icon: string;
  accentClass: string;
  glowClass: string;
  /** Optional formatter for the value */
  format?: (v: number) => string;
}

const METRIC_CARDS: MetricCard[] = [
  {
    key: 'interrupts',
    label: 'Interrupts',
    sublabel: 'Successful kicks',
    icon: '⚡',
    accentClass: 'text-teal-400',
    glowClass: 'shadow-teal-500/20',
  },
  {
    key: 'cc',
    label: 'Crowd Control',
    sublabel: 'Phase 3 — spell filter',
    icon: '🔒',
    accentClass: 'text-purple-400',
    glowClass: 'shadow-purple-500/20',
  },
  {
    key: 'avoidableDamageTaken',
    label: 'Damage Taken',
    sublabel: 'Total across the run',
    icon: '⚠️',
    accentClass: 'text-orange-400',
    glowClass: 'shadow-orange-500/20',
    format: (v) => {
      if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
      if (v >= 1_000)     return `${(v / 1_000).toFixed(0)}K`;
      return v.toString();
    },
  },
  {
    key: 'deaths',
    label: 'Total Deaths',
    sublabel: 'Count across the run',
    icon: '💀',
    accentClass: 'text-red-400',
    glowClass: 'shadow-red-500/20',
  },
];

function formatClearTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  return `${Math.floor(totalSec / 60)}:${(totalSec % 60).toString().padStart(2, '0')}`;
}

/** Pulsing placeholder shown while loading */
function MetricSkeleton() {
  return (
    <div className="h-8 w-16 rounded-md bg-white/[0.06] animate-pulse mx-auto" />
  );
}

export function PugVettingModal({
  run,
  characterName,
  realm,
  region,
  onClose,
}: PugVettingModalProps) {
  const [metrics, setMetrics] = useState<PugVettingMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setMetrics(null);

    fetchRunMetrics(characterName, realm, region, run)
      .then((m) => { if (!cancelled) { setMetrics(m); setLoading(false); } })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Unknown error');
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [characterName, realm, region, run]);

  const displayValue = (card: MetricCard): string | null => {
    if (loading)  return null;  // render skeleton
    if (!metrics) return '---';
    const raw = metrics[card.key];
    if (raw === null) return null; // Phase 3 placeholder
    return card.format ? card.format(raw) : raw.toString();
  };

  return (
    /* ── Backdrop ─────────────────────────────────────────────────────── */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="vetting-title"
    >
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* ── Modal card ─────────────────────────────────────────────────── */}
      <div className="relative z-10 w-full max-w-2xl rounded-2xl border border-white/10 bg-[#0e0e14] shadow-2xl shadow-black/60 overflow-hidden">

        {/* Top accent line */}
        <div className="h-px w-full bg-gradient-to-r from-transparent via-accent-teal/60 to-transparent" />

        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-4 border-b border-white/5">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-teal-400 text-lg">🔍</span>
              <h2 id="vetting-title" className="text-white font-bold text-lg">
                PUG Vetting Report
              </h2>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-widest bg-teal-500/10 text-teal-400 border border-teal-500/20">
                {loading ? 'Fetching…' : error ? 'Error' : 'Live Data'}
              </span>
            </div>
            <p className="text-slate-500 text-xs">
              {characterName} · {realm} · {region.toUpperCase()}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 p-1.5 rounded-lg text-slate-600 hover:text-slate-200 hover:bg-white/5 transition-colors"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>

        {/* ── Run summary strip ───────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-4 px-6 py-3.5 bg-white/[0.02] border-b border-white/5 text-sm">
          <span className="font-semibold text-slate-200">{run.dungeon}</span>
          <span className="px-2 py-0.5 rounded bg-accent-violet/10 text-accent-violet font-bold text-xs">
            +{run.mythic_level}
          </span>
          {run.score != null && (
            <span className="text-slate-500 text-xs">
              Score: <span className="text-slate-300 font-medium">{run.score.toFixed(1)}</span>
            </span>
          )}
          {run.clear_time_ms != null && (
            <span className="text-slate-500 text-xs">
              Time: <span className="text-slate-300 font-medium tabular-nums">{formatClearTime(run.clear_time_ms)}</span>
            </span>
          )}
          {(run.num_keystone_upgrades ?? 0) > 0 && (
            <span className="text-teal-500 text-xs font-medium">
              +{run.num_keystone_upgrades} Upgrade{(run.num_keystone_upgrades ?? 0) > 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* ── Error state ─────────────────────────────────────────────── */}
        {error && (
          <div className="mx-6 mt-5 rounded-xl border border-red-900/40 bg-red-950/10 p-4 text-sm text-red-400 leading-relaxed">
            <div className="flex items-center gap-2 mb-1 font-semibold text-red-300">
              <span>⚠</span> Could not load vetting data
            </div>
            {error}
          </div>
        )}

        {/* ── Metric cards ────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3 p-6">
          {METRIC_CARDS.map((card) => {
            const value = displayValue(card);
            const isPhase3 = !loading && metrics !== null && metrics[card.key] === null;

            return (
              <div
                key={card.key}
                className={`relative flex flex-col items-center gap-3 rounded-xl border border-white/5 bg-white/[0.03] px-4 py-5 text-center shadow-lg ${card.glowClass} overflow-hidden`}
              >
                <div className="absolute top-0 right-0 w-16 h-16 bg-white/[0.015] rounded-bl-full" />
                <span className="text-2xl leading-none">{card.icon}</span>

                <div className={`text-3xl font-black tracking-tight tabular-nums ${card.accentClass}`}>
                  {loading ? (
                    <MetricSkeleton />
                  ) : isPhase3 ? (
                    <span className="text-lg text-slate-600">Soon™</span>
                  ) : (
                    value ?? '---'
                  )}
                </div>

                <div className="space-y-0.5">
                  <div className="text-xs font-semibold text-slate-300">{card.label}</div>
                  <div className="text-[10px] text-slate-600">{card.sublabel}</div>
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Footer notice ───────────────────────────────────────────── */}
        {!error && (
          <div className="px-6 pb-5">
            <div className="rounded-lg bg-white/[0.02] border border-white/5 px-4 py-2.5 flex items-center gap-2">
              <span className="text-slate-600 text-xs">ℹ</span>
              <p className="text-slate-600 text-xs">
                {loading
                  ? 'Querying Warcraft Logs…'
                  : 'Metrics are fetched from the best-logged run matching this dungeon on Warcraft Logs.'}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
