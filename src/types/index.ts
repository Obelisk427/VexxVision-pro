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
  kills: { count: number } | null;
  difficulty: number;
  partition: number;
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

export interface ProcessedBossData {
  encounterId: number;
  encounterName: string;
  mythic: {
    rankPercent: number | null;
    kills: number | null;
    spec: string | null;
    fastestKill: number | null;
  };
  heroic: {
    rankPercent: number | null;
    kills: number | null;
    spec: string | null;
    fastestKill: number | null;
  };
}

export interface WCLRaidData {
  characterName: string;
  zone: WCLZone;
  bosses: ProcessedBossData[];
}

/** Holds raid data for both the current and previous tier zones. */
export interface WCLBothTiersData {
  current: WCLRaidData;
  previous: WCLRaidData | null;
}
