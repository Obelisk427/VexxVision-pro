import { useState } from 'react';
import type { PanelState, WCLBothTiersData, TierSelection } from '../types';
import { LoadingCard } from './LoadingCard';

interface RaidPerformancePanelProps {
  state: PanelState<WCLBothTiersData>;
  /** Controls which tier's zone + boss data is displayed. */
  tier: TierSelection;
}

type Difficulty = 'normal' | 'heroic' | 'mythic';

function getRankBadgeClass(percent: number | null): string {
  if (percent == null) return 'bg-white/5 text-slate-600';
  if (percent >= 99) return 'bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/30';
  if (percent >= 95) return 'bg-orange-500/15 text-orange-400 ring-1 ring-orange-500/30';
  if (percent >= 75) return 'bg-purple-500/15 text-purple-400 ring-1 ring-purple-500/30';
  if (percent >= 50) return 'bg-blue-500/15 text-blue-400 ring-1 ring-blue-500/30';
  if (percent >= 25) return 'bg-green-500/15 text-green-400 ring-1 ring-green-500/30';
  return 'bg-white/5 text-slate-500';
}

function getRankTierLabel(percent: number | null): string {
  if (percent == null) return '';
  if (percent >= 99) return 'Legendary';
  if (percent >= 95) return 'Epic';
  if (percent >= 75) return 'Rare';
  if (percent >= 50) return 'Uncommon';
  if (percent >= 25) return 'Common';
  return 'Poor';
}

function formatKillTime(ms: number | null): string {
  if (!ms) return '—';
  const totalSec = Math.floor(ms / 1000);
  return `${Math.floor(totalSec / 60)}:${(totalSec % 60).toString().padStart(2, '0')}`;
}

export function RaidPerformancePanel({ state, tier }: RaidPerformancePanelProps) {
  const [difficulty, setDifficulty] = useState<Difficulty>('mythic');

  if (state.loading) return <LoadingCard />;

  if (state.error) {
    return (
      <div className="rounded-xl border border-red-900/40 bg-red-950/10 p-6 space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-red-500">✗</span>
          <h2 className="text-base font-bold text-white">Raid Performance</h2>
        </div>
        <p className="text-red-400 text-sm leading-relaxed">{state.error}</p>
      </div>
    );
  }

  if (!state.data) return null;

  // Select the correct tier's data — null renders a graceful "not found" state
  const tierData = tier === 'current' ? state.data.current : state.data.previous;

  if (!tierData) {
    return (
      <div className="rounded-xl border border-white/5 bg-bg-card p-6 space-y-3">
        <h2 className="text-base font-bold text-white">Raid Performance</h2>
        <div className="rounded-lg border border-white/5 bg-white/[0.02] p-4 text-center text-sm text-slate-500">
          No previous tier data found for this character on Warcraft Logs.
        </div>
      </div>
    );
  }

  const { zone, bosses, characterName, characterRegion, characterServerSlug } = tierData;
  const killedBosses = bosses.filter((b) => (b[difficulty].kills ?? 0) > 0);
  const progress = `${killedBosses.length}/${bosses.length}`;
  const difficultyNum: Record<Difficulty, number> = { normal: 3, heroic: 4, mythic: 5 };

  const bossUrl = (encounterId: number) =>
    `https://www.warcraftlogs.com/character/${characterRegion}/${characterServerSlug}/${characterName.toLowerCase()}` +
    `#zone=${zone.id}&boss=${encounterId}&difficulty=${difficultyNum[difficulty]}`;

  return (
    <div className="rounded-xl border border-white/5 bg-bg-card p-6 space-y-5 flex flex-col">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <h2 className="text-base font-bold text-white">Raid Performance</h2>
          <p className="text-xs text-slate-600 mt-0.5">{zone.name}</p>
        </div>
        <div className="text-xs text-slate-600 text-right shrink-0">
          <div>{characterName}</div>
          <div className="mt-0.5">
            <span className="text-slate-400 font-semibold">{progress}</span>
            {' '}
            <span className="capitalize">{difficulty}</span> Kills
          </div>
        </div>
      </div>

      {/* ── Difficulty Tabs ─────────────────────────────────────────── */}
      <div className="flex gap-1 bg-bg-primary/60 rounded-lg p-1 w-fit border border-white/5">
        {(['normal', 'heroic', 'mythic'] as Difficulty[]).map((d) => (
          <button
            key={d}
            id={`raid-tab-${d}`}
            onClick={() => setDifficulty(d)}
            className={`px-4 py-1.5 rounded-md text-xs font-semibold uppercase tracking-wide transition-all ${
              difficulty === d
                ? 'bg-gradient-to-r from-accent-violet to-accent-teal text-white shadow-md'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            {d}
          </button>
        ))}
      </div>

      {/* ── Boss Table ──────────────────────────────────────────────── */}
      <div className="overflow-x-auto -mx-1">
        <table className="w-full text-sm min-w-[380px]">
          <thead>
            <tr className="text-slate-600 uppercase text-[10px] tracking-wider">
              <th className="text-left pb-2.5 pl-1 font-medium w-6">#</th>
              <th className="text-left pb-2.5 font-medium">Boss</th>
              <th className="text-center pb-2.5 font-medium">Best %</th>
              <th className="text-center pb-2.5 font-medium">Kills</th>
              <th className="text-right pb-2.5 pr-1 font-medium">Best Kill</th>
            </tr>
          </thead>
          <tbody>
            {bosses.map((boss, idx) => {
              const d = boss[difficulty];
              const hasKill = (d.kills ?? 0) > 0;

              return (
                <tr
                  key={boss.encounterId}
                  className={`border-t border-white/[0.04] transition-colors ${
                    hasKill ? 'hover:bg-white/[0.02]' : 'opacity-40'
                  }`}
                >
                  <td className="py-2.5 pl-1 text-slate-700 text-xs tabular-nums">{idx + 1}</td>
                  <td className="py-2.5 text-slate-200 font-medium">
                    <a
                      href={bossUrl(boss.encounterId)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-accent-teal hover:underline underline-offset-2 transition-colors"
                    >
                      {boss.encounterName}
                    </a>
                  </td>
                  <td className="py-2.5 text-center">
                    {d.rankPercent != null ? (
                      d.reportCode ? (
                        <a
                          href={`https://www.warcraftlogs.com/reports/${d.reportCode}#fight=${d.reportFightID ?? 'last'}&type=damage-done`}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={`${getRankTierLabel(d.rankPercent)} — open in Warcraft Logs`}
                          className={`inline-block px-2 py-0.5 rounded text-xs font-bold ring-1 ring-transparent hover:ring-accent-teal/60 hover:brightness-125 transition-all ${getRankBadgeClass(d.rankPercent)}`}
                        >
                          {d.rankPercent.toFixed(1)}%
                        </a>
                      ) : (
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-xs font-bold ${getRankBadgeClass(d.rankPercent)}`}
                          title={getRankTierLabel(d.rankPercent)}
                        >
                          {d.rankPercent.toFixed(1)}%
                        </span>
                      )
                    ) : (
                      <span className="text-slate-700 text-xs">—</span>
                    )}
                  </td>
                  <td className="py-2.5 text-center tabular-nums">
                    {d.kills != null ? (
                      <span className="font-semibold text-slate-300">{d.kills}</span>
                    ) : (
                      <span className="text-slate-600 text-xs">0</span>
                    )}
                  </td>
                  <td className="py-2.5 pr-1 text-right text-slate-600 text-xs tabular-nums">
                    {d.fastestKill && d.reportCode ? (
                      <a
                        href={`https://www.warcraftlogs.com/reports/${d.reportCode}#fight=${d.reportFightID ?? 'last'}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-accent-teal hover:underline transition-colors"
                      >
                        {formatKillTime(d.fastestKill)}
                      </a>
                    ) : (
                      formatKillTime(d.fastestKill)
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
