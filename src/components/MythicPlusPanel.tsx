import type { PanelState, RaiderIOData, TierSelection } from '../types';
import { LoadingCard } from './LoadingCard';

interface MythicPlusPanelProps {
  state: PanelState<RaiderIOData>;
  tier: TierSelection;
}

function getScoreColorClass(score: number): string {
  if (score >= 3000) return 'text-amber-400';
  if (score >= 2500) return 'text-orange-400';
  if (score >= 2000) return 'text-purple-400';
  if (score >= 1500) return 'text-blue-400';
  if (score >= 1000) return 'text-green-400';
  if (score >= 500) return 'text-slate-300';
  return 'text-slate-500';
}

function formatClearTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  return `${Math.floor(totalSec / 60)}:${(totalSec % 60).toString().padStart(2, '0')}`;
}

function upgradeLabel(n: number): string {
  return n > 0 ? `+${n}` : '—';
}

export function MythicPlusPanel({ state, tier }: MythicPlusPanelProps) {
  if (state.loading) return <LoadingCard />;

  if (state.error) {
    return (
      <div className="rounded-xl border border-red-900/40 bg-red-950/10 p-6 space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-red-500">✗</span>
          <h2 className="text-base font-bold text-white">Mythic+ Score & Best Runs</h2>
        </div>
        <p className="text-red-400 text-sm leading-relaxed">{state.error}</p>
      </div>
    );
  }

  if (!state.data) return null;

  const { profile, currentRuns, previousRuns } = state.data;

  // seasons[0] = current, seasons[1] = previous
  const seasons = profile.mythic_plus_scores_by_season ?? [];
  const seasonData = tier === 'current' ? seasons[0] ?? null : seasons[1] ?? null;
  const overallScore = seasonData?.scores?.all ?? 0;

  // Runs: use the pre-fetched correct array for each tier
  const runs = tier === 'current' ? currentRuns : previousRuns;
  const noPreviousScore = tier === 'previous' && !seasonData;

  return (
    <div className="rounded-xl border border-white/5 bg-bg-card p-6 space-y-5 flex flex-col">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-bold text-white">Mythic+ Score & Best Runs</h2>
          <p className="text-xs text-slate-600 mt-0.5">
            {profile.active_spec_name
              ? `${profile.active_spec_name} ${profile.class}`
              : profile.class}
          </p>
        </div>
        <span className="text-xs text-slate-600 uppercase tracking-widest shrink-0">
          {seasonData?.season?.replace(/^season-/, 'S') ??
            (tier === 'previous' ? 'Prev Season' : 'Current Season')}
        </span>
      </div>

      {noPreviousScore ? (
        <div className="rounded-lg border border-white/5 bg-white/[0.02] p-4 text-center text-sm text-slate-500">
          No previous season data available for this character.
        </div>
      ) : (
        /* ── Score display ──────────────────────────────────────── */
        <div className="flex items-center gap-4">
          <div className={`text-5xl font-black tracking-tight tabular-nums ${getScoreColorClass(overallScore)}`}>
            {overallScore > 0 ? overallScore.toFixed(1) : '—'}
          </div>
          <div className="space-y-1 text-xs text-slate-600">
            <div>Overall Score</div>
            {overallScore > 0 && seasonData?.scores && (
              <div className="flex gap-2">
                {(seasonData.scores.dps ?? 0) > 0 && (
                  <span>DPS: <span className="text-slate-400">{seasonData.scores.dps.toFixed(0)}</span></span>
                )}
                {(seasonData.scores.healer ?? 0) > 0 && (
                  <span>HPS: <span className="text-slate-400">{seasonData.scores.healer.toFixed(0)}</span></span>
                )}
                {(seasonData.scores.tank ?? 0) > 0 && (
                  <span>Tank: <span className="text-slate-400">{seasonData.scores.tank.toFixed(0)}</span></span>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Runs table ──────────────────────────────────────────────── */}
      <div className="border-t border-white/5" />

      {runs.length === 0 ? (
        <p className="text-slate-600 text-sm">
          {tier === 'previous'
            ? 'No previous season runs recorded for this character.'
            : 'No Mythic+ runs recorded this season.'}
        </p>
      ) : (
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-sm min-w-[380px]">
            <thead>
              <tr className="text-slate-600 uppercase text-[10px] tracking-wider">
                <th className="text-left pb-2.5 pl-1 font-medium">Dungeon</th>
                <th className="text-center pb-2.5 font-medium">+Key</th>
                <th className="text-center pb-2.5 font-medium">Upgrades</th>
                <th className="text-center pb-2.5 font-medium">Score</th>
                <th className="text-right pb-2.5 pr-1 font-medium">Time</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run, i) => (
                <tr
                  key={i}
                  className="border-t border-white/[0.04] hover:bg-white/[0.02] transition-colors"
                >
                  <td className="py-2.5 pl-1 text-slate-200 font-medium">{run.dungeon ?? '—'}</td>
                  <td className="py-2.5 text-center">
                    <span className="px-1.5 py-0.5 rounded bg-accent-violet/10 text-accent-violet font-bold text-xs">
                      +{run.mythic_level ?? '—'}
                    </span>
                  </td>
                  <td className="py-2.5 text-center text-slate-400 text-xs">
                    {upgradeLabel(run.num_keystone_upgrades ?? 0)}
                  </td>
                  <td className="py-2.5 text-center">
                    <span className={`font-semibold ${getScoreColorClass(run.score ?? 0)}`}>
                      {run.score != null ? run.score.toFixed(1) : '—'}
                    </span>
                  </td>
                  <td className="py-2.5 pr-1 text-right text-slate-500 text-xs tabular-nums">
                    {run.clear_time_ms != null ? formatClearTime(run.clear_time_ms) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
