// ─── Shared ─────────────────────────────────────────────────────────────────

export type Region = 'us' | 'eu';
export type TierSelection = 'current' | 'previous';

export interface CharacterQuery {
  name: string;
  realm: string;
  region: Region;
}

export interface PanelState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

// ─── Raider.io ───────────────────────────────────────────────────────────────

export interface RaiderIOScores {
  all: number;
  dps: number;
  healer: number;
  tank: number;
  spec_0: number;
  spec_1: number;
  spec_2: number;
  spec_3: number;
}

export interface RaiderIOMythicPlusSeason {
  season: string;
  scores: RaiderIOScores;
}

export interface RaiderIOBestRun {
  dungeon: string;
  short_name: string;
  mythic_level: number;
  completed_at: string;
  clear_time_ms: number;
  par_time_ms: number;
  num_keystone_upgrades: number;
  score: number;
  /** Direct Raider.io URL to this specific run page. */
  url?: string;
  affixes: Array<{
    id: number;
    name: string;
    description: string;
    icon: string;
  }>;
}

export interface RaiderIOProfile {
  name: string;
  race: string;
  class: string;
  active_spec_name: string;
  active_spec_role: string;
  gender: string;
  faction: string;
  achievement_points: number;
  thumbnail_url: string;
  region: string;
  realm: string;
  last_crawled_at: string;
  profile_url: string;
  mythic_plus_scores_by_season: RaiderIOMythicPlusSeason[] | null;
  mythic_plus_best_runs: RaiderIOBestRun[] | null;
}

/**
 * Result of the two-step Raider.io fetch:
 * - profile + scores come from one request
 * - previousRuns come from a second request using the dynamic previous-season slug
 */
export interface RaiderIOData {
  profile: RaiderIOProfile;
  currentRuns: RaiderIOBestRun[];
  previousRuns: RaiderIOBestRun[];
}

// ─── Warcraft Logs ───────────────────────────────────────────────────────────

export interface WCLEncounter {
  id: number;
  name: string;
}

export interface WCLZone {
  id: number;
  name: string;
  encounters: WCLEncounter[];
}

export interface WCLBossRanking {
  encounter: {
    id: number;
    name: string;
  };
  rankPercent: number;
  medianPercent: number;
  bestAmount: number;
  fastestKill: number;
  spec: string;
  /** Flat kill count returned by WCL zoneRankings (not nested as kills.count) */
  totalKills: number | null;
  difficulty: number;
  partition: number;
  /** Report link data — present when zone data is available. */
  report?: {
    code: string;
    fightID: number;
  } | null;
}

export interface WCLZoneRankings {
  allStars: Array<{
    partition: number;
    spec: string;
    points: number;
    possible: number;
    rank: number;
    regionRank: number;
    serverRank: number;
    rankPercent: number;
  }> | null;
  rankings: WCLBossRanking[] | null;
}

/** Per-difficulty boss data including optional report link for clickable parses. */
export interface BossRankData {
  rankPercent: number | null;
  kills: number | null;
  spec: string | null;
  fastestKill: number | null;
  reportCode: string | null;
  reportFightID: number | null;
}

export interface ProcessedBossData {
  encounterId: number;
  encounterName: string;
  normal: BossRankData;
  heroic: BossRankData;
  mythic: BossRankData;
}

export interface WCLRaidData {
  characterName: string;
  /** lowercase region code, e.g. "us" */
  characterRegion: string;
  /** WCL server slug, e.g. "illidan", "area-52" */
  characterServerSlug: string;
  zone: WCLZone;
  bosses: ProcessedBossData[];
}

/** Holds raid data for both the current and previous tier zones. */
export interface WCLBothTiersData {
  current: WCLRaidData;
  previous: WCLRaidData | null;
}

/** Live per-run behaviour metrics fetched from WCL event tables. */
export interface PugVettingMetrics {
  /** Total successful interrupts by this character in the run. */
  interrupts: number | null;
  /** Crowd-control casts identified from the Casts table. */
  cc: number | null;
  /** Total damage taken from all sources (proxy for avoidable damage). */
  avoidableDamageTaken: number | null;
  /** Total deaths for this character in the run. */
  deaths: number | null;
}

export type PugVettingFailureReason = 'no_log_found';

export type PugVettingResult =
  | {
      success: true;
      metrics: PugVettingMetrics;
      reportCode: string;
      fightID: number;
      matchedDungeon: string;
    }
  | {
      success: false;
      reason: PugVettingFailureReason;
    };
