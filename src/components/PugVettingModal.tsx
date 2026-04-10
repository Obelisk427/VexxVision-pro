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

function formatClearTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  return `${Math.floor(totalSec / 60)}:${(totalSec % 60).toString().padStart(2, '0')}`;
}

function formatDps(dps: number): string {
  if (dps >= 1_000_000) return `${(dps / 1_000_000).toFixed(1)}M`;
  if (dps >= 1_000) return `${(dps / 1_000).toFixed(1)}K`;
  return dps.toString();
}

function formatDamageRaw(dmg: number): string {
  if (dmg >= 1_000_000) return `${(dmg / 1_000_000).toFixed(1)}M`;
  if (dmg >= 1_000) return `${(dmg / 1_000).toFixed(0)}K`;
  return dmg.toString();
}

/** Returns color class and label for the relative damage metric. */
function getDamageContext(percent: number | null, isTank: boolean): { color: string; label: string } {
  if (percent === null) return { color: 'text-slate-500', label: 'N/A' };

  if (isTank) {
    // Tank: showing % of group damage. 35-55% is normal.
    return { color: 'text-blue-400', label: `${percent}% of group` };
  }

  // Non-tank: positive = above avg (bad), negative = below avg (good)
  if (percent <= -15) return { color: 'text-green-400', label: `${percent}% vs avg` };
  if (percent <= 5) return { color: 'text-slate-300', label: `${percent > 0 ? '+' : ''}${percent}% vs avg` };
  if (percent <= 20) return { color: 'text-orange-400', label: `+${percent}% vs avg` };
  return { color: 'text-red-400', label: `+${percent}% vs avg` };
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
  const [noLogFound, setNoLogFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setMetrics(null);
    setNoLogFound(false);

    fetchRunMetrics(characterName, realm, region, run)
      .then((result) => {
        if (cancelled) return;
        if (!result.success) {
          setNoLogFound(result.reason === 'no_log_found');
          setLoading(false);
          return;
        }

        setMetrics(result.metrics);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Unknown error');
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [characterName, realm, region, run]);

  const dmgCtx = metrics ? getDamageContext(metrics.damageTakenPercent, metrics.isTank) : null;

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
              <span className="text-teal-400 text-lg">⚖️</span>
              <h2 id="vetting-title" className="text-white font-bold text-lg">
                Are They Worthy?
              </h2>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-widest bg-teal-500/10 text-teal-400 border border-teal-500/20">
                {loading ? 'Fetching…' : error ? 'Error' : noLogFound ? 'No Log' : 'Live Data'}
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

        {/* ── Metric cards / empty state ─────────────────────────────── */}
        {noLogFound ? (
          <div className="p-6">
            <div className="rounded-2xl border border-white/8 bg-gradient-to-br from-white/[0.04] to-white/[0.02] px-6 py-10 text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-2xl">
                📭
              </div>
              <h3 className="text-base font-semibold text-white">No Combat Log Found</h3>
              <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-400">
                This Mythic+ run was not recorded and uploaded to Warcraft Logs.
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 p-6">

            {/* ── Interrupts ─────────────────────────────────────────── */}
            <div className="relative flex flex-col items-center gap-3 rounded-xl border border-white/5 bg-white/[0.03] px-4 py-5 text-center shadow-lg shadow-teal-500/20 overflow-hidden">
              <div className="absolute top-0 right-0 w-16 h-16 bg-white/[0.015] rounded-bl-full" />
              <span className="text-2xl leading-none">⚡</span>
              <div className="text-3xl font-black tracking-tight tabular-nums text-teal-400">
                {loading ? <MetricSkeleton /> : (metrics?.interrupts ?? 0)}
              </div>
              <div className="space-y-0.5">
                <div className="text-xs font-semibold text-slate-300">Interrupts</div>
                <div className="text-[10px] text-slate-600">Successful kicks</div>
              </div>
            </div>

            {/* ── DPS ────────────────────────────────────────────────── */}
            <div className="relative flex flex-col items-center gap-3 rounded-xl border border-white/5 bg-white/[0.03] px-4 py-5 text-center shadow-lg shadow-purple-500/20 overflow-hidden">
              <div className="absolute top-0 right-0 w-16 h-16 bg-white/[0.015] rounded-bl-full" />
              <span className="text-2xl leading-none">⚔️</span>
              <div className="text-3xl font-black tracking-tight tabular-nums text-purple-400">
                {loading ? <MetricSkeleton /> : formatDps(metrics?.dps ?? 0)}
              </div>
              <div className="space-y-0.5">
                <div className="text-xs font-semibold text-slate-300">DPS Output</div>
                <div className="text-[10px] text-slate-600">Damage per second</div>
              </div>
            </div>

            {/* ── Damage Taken (Relative) ────────────────────────────── */}
            <div className="relative flex flex-col items-center gap-3 rounded-xl border border-white/5 bg-white/[0.03] px-4 py-5 text-center shadow-lg shadow-orange-500/20 overflow-hidden">
              <div className="absolute top-0 right-0 w-16 h-16 bg-white/[0.015] rounded-bl-full" />
              <span className="text-2xl leading-none">🛡️</span>
              <div className={`text-2xl font-black tracking-tight tabular-nums ${loading ? '' : dmgCtx?.color ?? 'text-slate-500'}`}>
                {loading ? <MetricSkeleton /> : dmgCtx?.label ?? 'N/A'}
              </div>
              <div className="space-y-0.5">
                <div className="text-xs font-semibold text-slate-300">Damage Taken</div>
                <div className="text-[10px] text-slate-600">
                  {loading
                    ? 'Analyzing…'
                    : metrics?.isTank
                      ? `Tank · ${formatDamageRaw(metrics?.damageTakenRaw ?? 0)} total`
                      : `${formatDamageRaw(metrics?.damageTakenRaw ?? 0)} total`
                  }
                </div>
              </div>
            </div>

            {/* ── Deaths ─────────────────────────────────────────────── */}
            <div className="relative flex flex-col items-center gap-3 rounded-xl border border-white/5 bg-white/[0.03] px-4 py-5 text-center shadow-lg shadow-red-500/20 overflow-hidden">
              <div className="absolute top-0 right-0 w-16 h-16 bg-white/[0.015] rounded-bl-full" />
              <span className="text-2xl leading-none">💀</span>
              <div className="text-3xl font-black tracking-tight tabular-nums text-red-400">
                {loading ? <MetricSkeleton /> : (metrics?.deaths ?? 0)}
              </div>
              <div className="space-y-0.5">
                <div className="text-xs font-semibold text-slate-300">Deaths</div>
                <div className="text-[10px] text-slate-600">Count across the run</div>
              </div>
            </div>

          </div>
        )}

        {/* ── Footer notice ───────────────────────────────────────────── */}
        {!error && (
          <div className="px-6 pb-5">
            <div className="rounded-lg bg-white/[0.02] border border-white/5 px-4 py-2.5 flex items-center gap-2">
              <span className="text-slate-600 text-xs">ℹ</span>
              <p className="text-slate-600 text-xs">
                {loading
                  ? 'Querying Warcraft Logs…'
                  : noLogFound
                    ? 'No uploaded Warcraft Logs report could be matched to this Raider.io run.'
                    : 'Metrics from the best-logged run. Damage comparison excludes the tank for non-tank players.'}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
