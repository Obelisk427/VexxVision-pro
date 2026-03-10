import { useState } from 'react';
import { SearchBar } from './SearchBar';
import { MythicPlusPanel } from './MythicPlusPanel';
import { RaidPerformancePanel } from './RaidPerformancePanel';
import { ErrorBoundary } from './ErrorBoundary';
import { fetchRaiderIOData } from '../services/raiderIo';
import { fetchWCLData } from '../services/warcraftLogs';
import type {
  CharacterQuery,
  PanelState,
  RaiderIOData,
  WCLBothTiersData,
  TierSelection,
} from '../types';

const EMPTY_PANEL = <T,>(): PanelState<T> => ({
  data: null,
  loading: false,
  error: null,
});

// ─── App Logo ─────────────────────────────────────────────────────────────────

function AppLogo({ className }: { className?: string }) {
  const [imgFailed, setImgFailed] = useState(false);

  if (!imgFailed) {
    return (
      <img
        src="/vexx-logo.png"
        alt="VexxVision"
        className={`object-cover aspect-square ${className ?? ''}`}
        onError={() => setImgFailed(true)}
      />
    );
  }

  // Fallback icon when the image hasn't been uploaded yet
  return (
    <div className={`bg-gradient-to-br from-accent-violet to-accent-teal flex items-center justify-center ${className}`}>
      <svg className="w-1/2 h-1/2 text-white" fill="currentColor" viewBox="0 0 20 20">
        <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
      </svg>
    </div>
  );
}

// ─── Tier toggle ──────────────────────────────────────────────────────────────

function TierToggle({
  value,
  onChange,
}: {
  value: TierSelection;
  onChange: (v: TierSelection) => void;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="text-xs text-slate-500 uppercase tracking-widest hidden sm:block">Tier</span>
      <div className="flex gap-1 bg-bg-primary/60 rounded-lg p-1 border border-white/5">
        {(['current', 'previous'] as TierSelection[]).map((t) => (
          <button
            key={t}
            id={`tier-toggle-${t}`}
            onClick={() => onChange(t)}
            className={`px-3.5 py-1 rounded-md text-xs font-semibold tracking-wide transition-all ${
              value === t
                ? 'bg-gradient-to-r from-accent-violet to-accent-teal text-white shadow'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            {t === 'current' ? 'Current Tier' : 'Previous Tier'}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export function Dashboard() {
  const [hasSearched, setHasSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [currentQuery, setCurrentQuery] = useState<CharacterQuery | null>(null);
  const [tier, setTier] = useState<TierSelection>('current');

  const [mythicState, setMythicState] = useState<PanelState<RaiderIOData>>(EMPTY_PANEL());
  const [raidState, setRaidState] = useState<PanelState<WCLBothTiersData>>(EMPTY_PANEL());

  const handleSearch = async (query: CharacterQuery) => {
    setHasSearched(true);
    setSearching(true);
    setCurrentQuery(query);
    setTier('current'); // reset to current on every new search
    setMythicState({ data: null, loading: true, error: null });
    setRaidState({ data: null, loading: true, error: null });

    const [rioResult, wclResult] = await Promise.allSettled([
      fetchRaiderIOData(query.name, query.realm, query.region),
      fetchWCLData(query.name, query.realm, query.region),
    ]);

    setMythicState({
      loading: false,
      data: rioResult.status === 'fulfilled' ? rioResult.value : null,
      error:
        rioResult.status === 'rejected'
          ? String((rioResult.reason as Error).message ?? rioResult.reason)
          : null,
    });

    setRaidState({
      loading: false,
      data: wclResult.status === 'fulfilled' ? wclResult.value : null,
      error:
        wclResult.status === 'rejected'
          ? String((wclResult.reason as Error).message ?? wclResult.reason)
          : null,
    });

    setSearching(false);
  };

  return (
    <div className="min-h-screen bg-bg-primary text-white font-sans antialiased">
      {/* ── Top nav bar ────────────────────────────────────────────── */}
      <header className="sticky top-0 z-20 border-b border-white/5 bg-bg-secondary/80 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-4">
          {/* Logo */}
          <a
            href="/"
            onClick={() => { setHasSearched(false); setCurrentQuery(null); }}
            className="flex items-center gap-2.5 shrink-0 group"
          >
            <AppLogo className="w-8 h-8 rounded-lg shadow-lg shadow-purple-500/20 group-hover:brightness-110 transition" />
            <span className="font-bold text-white text-base tracking-tight hidden sm:block">
              VexxVision
            </span>
          </a>

          {/* Compact search bar — only after first search */}
          {hasSearched && (
            <div className="flex-1 min-w-0">
              <SearchBar onSearch={handleSearch} loading={searching} compact />
            </div>
          )}
        </div>
      </header>

      {/* ── Main content ───────────────────────────────────────────── */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {!hasSearched ? (
          /* ── Hero / Landing ──────────────────────────────────────── */
          <div className="flex flex-col items-center justify-center min-h-[65vh] text-center gap-8">
            {/* Glowing logo */}
            <div className="relative">
              <div className="absolute -inset-8 bg-accent-violet/10 rounded-full blur-2xl animate-pulse" />
              <AppLogo className="relative w-20 h-20 rounded-xl shadow-lg shadow-purple-500/20" />
            </div>

            <div className="space-y-3">
              <h1 className="text-4xl sm:text-5xl font-black text-white tracking-tight">
                <span className="bg-gradient-to-r from-accent-violet to-accent-teal bg-clip-text text-transparent">
                  VexxVision
                </span>
              </h1>
              <p className="text-slate-400 text-lg max-w-xl italic">
                "Because 'Trust me bro' isn't a valid parse."
              </p>
            </div>

            <div className="w-full max-w-3xl">
              <SearchBar onSearch={handleSearch} loading={searching} />
            </div>

            <div className="flex flex-wrap gap-2 justify-center text-xs text-slate-600">
              <span className="px-3 py-1 rounded-full border border-white/5 bg-white/[0.03]">
                ⚡ Real-time Raider.io data
              </span>
              <span className="px-3 py-1 rounded-full border border-white/5 bg-white/[0.03]">
                🔮 Dynamic raid tier detection
              </span>
              <span className="px-3 py-1 rounded-full border border-white/5 bg-white/[0.03]">
                📊 Cross-partition ranking merge
              </span>
            </div>
          </div>
        ) : (
          /* ── Results view ────────────────────────────────────────── */
          <div className="space-y-5">
            {/* Result header: breadcrumb + tier toggle */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              {currentQuery && (
                <div className="text-sm text-slate-600">
                  Results for{' '}
                  <span className="font-semibold text-slate-200">{currentQuery.name}</span>
                  {' · '}
                  <span className="text-slate-500">{currentQuery.realm}</span>
                  {' '}
                  <span className="text-xs uppercase text-slate-700">[{currentQuery.region}]</span>
                </div>
              )}

              {/* Global tier toggle — only show once data is loaded */}
              {!mythicState.loading && !raidState.loading && (
                <TierToggle value={tier} onChange={setTier} />
              )}
            </div>

            {/* Panel grid */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
              <ErrorBoundary>
                <MythicPlusPanel state={mythicState} tier={tier} />
              </ErrorBoundary>
              <ErrorBoundary>
                <RaidPerformancePanel state={raidState} tier={tier} />
              </ErrorBoundary>
            </div>
          </div>
        )}
      </main>

      {/* ── Footer ─────────────────────────────────────────────────── */}
      <footer className="mt-16 border-t border-white/5 py-6">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 text-center text-xs text-slate-700 space-y-1">
          <p>Data provided by Raider.io and Warcraft Logs. Not affiliated with Blizzard Entertainment.</p>
          <p>VexxVision · Streamer Toolkit</p>
        </div>
      </footer>
    </div>
  );
}
