import type {
  Region,
  WCLZone,
  WCLZoneRankings,
  WCLRaidData,
  WCLBothTiersData,
  BossRankData,
  ProcessedBossData,
  PugVettingMetrics,
  PugVettingResult,
  RaiderIOBestRun,
} from '../types';

const WCL_TOKEN_URL = 'https://www.warcraftlogs.com/oauth/token';
const WCL_GQL_URL = 'https://www.warcraftlogs.com/api/v2/client';

// ─── OAuth ───────────────────────────────────────────────────────────────────

async function fetchWCLToken(): Promise<string> {
  const clientId = import.meta.env.VITE_WCL_CLIENT_ID as string | undefined;
  const clientSecret = import.meta.env.VITE_WCL_CLIENT_SECRET as string | undefined;

  if (!clientId || !clientSecret) {
    throw new Error(
      'WCL credentials are missing. Ensure VITE_WCL_CLIENT_ID and VITE_WCL_CLIENT_SECRET are set in .env',
    );
  }

  const credentials = btoa(`${clientId}:${clientSecret}`);

  const response = await fetch(WCL_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!response.ok) {
    throw new Error(
      `WCL OAuth failed (${response.status}). Verify your client credentials in .env`,
    );
  }

  const json = (await response.json()) as { access_token: string };
  return json.access_token;
}

// ─── GraphQL Helper ──────────────────────────────────────────────────────────

async function gqlQuery<T>(
  token: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(WCL_GQL_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`WCL GraphQL request failed: ${response.status} ${response.statusText}`);
  }

  const json = (await response.json()) as {
    data?: T;
    errors?: Array<{ message: string }>;
  };

  if (json.errors?.length) {
    throw new Error(`WCL GraphQL error: ${json.errors[0].message}`);
  }
  if (!json.data) {
    throw new Error('WCL API returned an empty response.');
  }

  return json.data;
}

// ─── Dynamic Zone Discovery ───────────────────────────────────────────────────

const ZONE_DISCOVERY_QUERY = /* GraphQL */ `
  query {
    worldData {
      expansions {
        id
        name
        zones {
          id
          name
          encounters {
            id
            name
          }
        }
      }
    }
  }
`;

interface ZoneQueryResult {
  worldData: {
    expansions: Array<{
      id: number;
      name: string;
      zones: Array<{
        id: number;
        name: string;
        encounters: Array<{ id: number; name: string }>;
      }>;
    }>;
  };
}

// ─── Hardcoded Zone IDs ──────────────────────────────────────────────────────
// Update these when a new tier releases. Zone IDs are stable in WCL's API.
const CURRENT_ZONE_ID = 48;  // Midnight Falls (Midnight expansion, current tier)
const PREVIOUS_ZONE_ID = 44; // Manaforge Omega (The War Within, previous tier)

interface RecentZones {
  current: WCLZone;
  previous: WCLZone | null;
}

/**
 * Looks up zones by their hardcoded IDs from the worldData response.
 * Falling back to dynamic selection would risk grabbing M+ Season zones,
 * so we use explicit IDs for rock-solid correctness during the season launch window.
 */
async function fetchRecentRaidZones(token: string): Promise<RecentZones> {
  const data = await gqlQuery<ZoneQueryResult>(token, ZONE_DISCOVERY_QUERY);
  const expansions = data.worldData?.expansions;

  if (!expansions?.length) {
    throw new Error('WCL returned no expansion data during zone discovery.');
  }

  // Flatten all zones across all expansions for ID lookup
  const allZones = expansions.flatMap((exp) => exp.zones);

  const findById = (id: number): WCLZone | null =>
    allZones.find((z) => z.id === id) ?? null;

  const currentZone = findById(CURRENT_ZONE_ID);
  if (!currentZone) {
    throw new Error(
      `Zone ${CURRENT_ZONE_ID} (current tier) was not found in WCL worldData. ` +
      'The zone ID may have changed — update CURRENT_ZONE_ID in warcraftLogs.ts.',
    );
  }

  return {
    current: currentZone,
    previous: findById(PREVIOUS_ZONE_ID), // null = no previous tier data
  };
}


// ─── Character Rankings ───────────────────────────────────────────────────────

/**
 * Queries 9 aliases: 3 difficulties (Normal/Heroic/Mythic) × 3 partitions.
 * Pre-Patch data lives in partition 3; main season in partition 1.
 * Omitting the partition argument would return WCL's default (usually P1 only).
 * Fetching all three explicitly lets us aggregate across the full history.
 */
const CHARACTER_RANKINGS_QUERY = /* GraphQL */ `
  query(
    $name: String!
    $serverSlug: String!
    $serverRegion: String!
    $zoneID: Int!
  ) {
    characterData {
      character(
        name: $name
        serverSlug: $serverSlug
        serverRegion: $serverRegion
      ) {
        name
        normalP1: zoneRankings(zoneID: $zoneID, difficulty: 3, partition: 1)
        normalP2: zoneRankings(zoneID: $zoneID, difficulty: 3, partition: 2)
        normalP3: zoneRankings(zoneID: $zoneID, difficulty: 3, partition: 3)
        heroicP1: zoneRankings(zoneID: $zoneID, difficulty: 4, partition: 1)
        heroicP2: zoneRankings(zoneID: $zoneID, difficulty: 4, partition: 2)
        heroicP3: zoneRankings(zoneID: $zoneID, difficulty: 4, partition: 3)
        mythicP1: zoneRankings(zoneID: $zoneID, difficulty: 5, partition: 1)
        mythicP2: zoneRankings(zoneID: $zoneID, difficulty: 5, partition: 2)
        mythicP3: zoneRankings(zoneID: $zoneID, difficulty: 5, partition: 3)
      }
    }
  }
`;

interface CharRankingsResult {
  characterData: {
    character: {
      name: string;
      normalP1: WCLZoneRankings; normalP2: WCLZoneRankings; normalP3: WCLZoneRankings;
      heroicP1: WCLZoneRankings; heroicP2: WCLZoneRankings; heroicP3: WCLZoneRankings;
      mythicP1: WCLZoneRankings; mythicP2: WCLZoneRankings; mythicP3: WCLZoneRankings;
    } | null;
  };
}

async function fetchCharacterRaidData(
  token: string,
  name: string,
  realm: string,
  region: Region,
  zone: WCLZone,
): Promise<WCLRaidData> {
  // WCL serverSlug: lowercase, spaces → hyphens, apostrophes removed
  // e.g. "Area 52" → "area-52", "Kel'Thuzad" → "kelthuzad"
  const serverSlug = realm.trim().toLowerCase().replace(/'/g, '').replace(/\s+/g, '-');
  const serverRegion = region.toUpperCase();

  const data = await gqlQuery<CharRankingsResult>(token, CHARACTER_RANKINGS_QUERY, {
    name,
    serverSlug,
    serverRegion,
    zoneID: zone.id,
  });
  console.log('WCL Raw Response:', JSON.stringify(data, null, 2));

  const character = data.characterData?.character;

  if (!character) {
    throw new Error(
      `Character "${name}" on "${realm}" (${serverRegion}) was not found on Warcraft Logs.`,
    );
  }

  /**
   * Aggregates across multiple partitions for a single boss encounter:
   * - Best rankPercent wins (highest percentile parse)
   * - Kills are SUMMED across all partitions (captures Pre-Patch + main season)
   * - Report link comes from the partition that had the best parse
   */
  type PartialBossRank = Omit<BossRankData, 'rankPercent' | 'kills' | 'spec' | 'fastestKill'> & {
    rankPercent: number; kills: number; spec: string; fastestKill: number;
  };

  function aggregatePartitions(
    partitions: (WCLZoneRankings | null | undefined)[],
    encounterId: number,
  ): PartialBossRank | null {
    let best: PartialBossRank | null = null;
    let totalKills = 0;

    for (const partition of partitions) {
      const r = partition?.rankings?.find((row) => row.encounter?.id === encounterId);
      if (!r) continue;
      const k = r.totalKills ?? 0;
      totalKills += k;
      if (k > 0 && (!best || r.rankPercent > best.rankPercent)) {
        best = {
          rankPercent: r.rankPercent,
          kills: k,           // will be overwritten with totalKills below
          spec: r.spec ?? '',
          fastestKill: r.fastestKill ?? 0,
          reportCode: r.report?.code ?? null,
          reportFightID: r.report?.fightID ?? null,
        };
      }
    }

    if (!best || totalKills === 0) return null;
    return { ...best, kills: totalKills }; // replace per-partition kills with total
  }

  const bosses: ProcessedBossData[] = zone.encounters.map((encounter) => {
    const normal = aggregatePartitions(
      [character.normalP1, character.normalP2, character.normalP3], encounter.id);
    const heroic = aggregatePartitions(
      [character.heroicP1, character.heroicP2, character.heroicP3], encounter.id);
    const mythic = aggregatePartitions(
      [character.mythicP1, character.mythicP2, character.mythicP3], encounter.id);

    const slot = (r: PartialBossRank | null) => ({
      rankPercent: r?.rankPercent ?? null,
      kills:       r?.kills       ?? null,
      spec:        r?.spec        ?? null,
      fastestKill: r?.fastestKill ?? null,
      reportCode:  r?.reportCode  ?? null,
      reportFightID: r?.reportFightID ?? null,
    });

    return {
      encounterId: encounter.id,
      encounterName: encounter.name,
      normal: slot(normal),
      heroic: slot(heroic),
      mythic: slot(mythic),
    };
  });

  return {
    characterName: character.name,
    characterRegion: region.toLowerCase(),
    characterServerSlug: serverSlug,
    zone,
    bosses,
  };
}


// ─── Master Entry Point ───────────────────────────────────────────────────────

/**
 * Full WCL data pipeline:
 * 1. Obtain OAuth token
 * 2. Discover the 2 most recent raid zones
 * 3. Fetch character rankings for BOTH zones in parallel (no extra round-trips on tier toggle)
 */
export async function fetchWCLData(
  name: string,
  realm: string,
  region: Region,
): Promise<WCLBothTiersData> {
  const token = await fetchWCLToken();
  const zones = await fetchRecentRaidZones(token);

  const [currentResult, previousResult] = await Promise.allSettled([
    fetchCharacterRaidData(token, name, realm, region, zones.current),
    zones.previous
      ? fetchCharacterRaidData(token, name, realm, region, zones.previous)
      : Promise.resolve(null),
  ]);

  // Current is required — propagate error if it fails
  if (currentResult.status === 'rejected') throw currentResult.reason;

  return {
    current: currentResult.value,
    // Previous failure is soft — renders as null/unavailable in the UI
    previous: previousResult.status === 'fulfilled' ? previousResult.value : null,
  };
}

// ─── PUG Vetting ─────────────────────────────────────────────────────────────

/**
 * WCL table scalar response — each table query returns a JSON blob
 * with an `entries` array of per-player aggregates.
 */
interface WCLTableEntry {
  name?: string;
  id?: number;
  total?: number;
  guid?: number;
  entries?: WCLTableEntry[];
}
interface WCLTableScalar {
  data?: { entries?: WCLTableEntry[] };
}

interface CharMPlusResult {
  characterData: {
    character: {
      name: string;
      [key: string]: WCLZoneRankings | string | null;
    } | null;
  };
}

interface ReportTablesResult {
  reportData: {
    report: {
      interrupts:   WCLTableScalar;
    } | null;
  };
}

interface ReportFightWindowResult {
  reportData: {
    report: {
      fights: Array<{
        id: number;
        startTime: number;
        endTime: number;
      }> | null;
    } | null;
  };
}

/**
 * Scans all M+ season zones from worldData and returns the zone ID that
 * contains an encounter name matching `dungeonName`.
 * Iterates newest → oldest so current-season zones win ties.
 * Uses the same encounter data already fetched by ZONE_DISCOVERY_QUERY —
 * no extra API call needed.
 */
interface MPlusZoneCandidate {
  zoneID: number;
  zoneName: string;
  matchedEncounterName: string;
  nameScore: number;
}

const DUNGEON_FALLBACK_ALIASES: Record<string, string[]> = {
  'halls of atonement': ['lord chamberlain', 'echelon', 'high adjudicator aleez', 'halkias'],
};

function normalize(s: string): string {
  return s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function stripLeadingArticles(s: string): string {
  return s.replace(/^(the|a|an)\s+/, '');
}

function buildDungeonAliases(run: RaiderIOBestRun): string[] {
  const rawNames = [run.dungeon, run.short_name].filter(Boolean) as string[];
  const aliases = new Set<string>();

  for (const raw of rawNames) {
    const normalized = normalize(raw);
    if (!normalized) continue;
    aliases.add(normalized);
    aliases.add(stripLeadingArticles(normalized));

    const colonParts = normalized.split(':').map((part) => part.trim()).filter(Boolean);
    for (const part of colonParts) {
      aliases.add(part);
      aliases.add(stripLeadingArticles(part));
    }

    const ofParts = normalized.split(/\bof\b/).map((part) => part.trim()).filter(Boolean);
    for (const part of ofParts) {
      aliases.add(part);
      aliases.add(stripLeadingArticles(part));
    }
  }

  const dungeonKey = normalize(run.dungeon);
  for (const fallback of DUNGEON_FALLBACK_ALIASES[dungeonKey] ?? []) {
    aliases.add(normalize(fallback));
  }

  return Array.from(aliases).filter(Boolean);
}

function dungeonNameScore(aliases: string[], candidateName: string): number {
  const candidate = stripLeadingArticles(normalize(candidateName));
  let best = 0;

  for (const alias of aliases) {
    if (!alias) continue;
    if (candidate === alias) return 100;
    if (candidate.includes(alias) || alias.includes(candidate)) {
      best = Math.max(best, 85 - Math.abs(candidate.length - alias.length));
      continue;
    }

    const aliasTokens = new Set(alias.split(' ').filter(Boolean));
    const candidateTokens = new Set(candidate.split(' ').filter(Boolean));
    const overlap = [...aliasTokens].filter((token) => candidateTokens.has(token)).length;
    const tokenScore = overlap * 10;
    best = Math.max(best, tokenScore);
  }

  return best;
}

async function findMPlusZonesForDungeon(
  token: string,
  run: RaiderIOBestRun,
): Promise<MPlusZoneCandidate[]> {
  const data = await gqlQuery<ZoneQueryResult>(token, ZONE_DISCOVERY_QUERY);
  const allZones = (data.worldData?.expansions ?? []).flatMap((e) => e.zones);
  const aliases = buildDungeonAliases(run);

  const mPlusZones = allZones
    .filter((z) => {
      const lower = z.name.toLowerCase();
      return (lower.includes('season') || lower.includes('mythic+')) && z.encounters.length >= 6;
    })
    .sort((a, b) => b.id - a.id);

  if (!mPlusZones.length) {
    return [];
  }

  const candidates: MPlusZoneCandidate[] = [];
  for (const zone of mPlusZones) {
    const zoneNameScore = dungeonNameScore(aliases, zone.name);
    const bestEncounter = zone.encounters
      .map((enc) => ({
        enc,
        score: dungeonNameScore(aliases, enc.name),
      }))
      .sort((a, b) => b.score - a.score)[0];

    const bestScore = Math.max(zoneNameScore, bestEncounter?.score ?? 0);
    if (bestScore >= 20) {
      candidates.push({
        zoneID: zone.id,
        zoneName: zone.name,
        matchedEncounterName: bestEncounter?.enc.name ?? zone.name,
        nameScore: bestScore,
      });
    }
  }

  return candidates.sort((a, b) => b.nameScore - a.nameScore || b.zoneID - a.zoneID).slice(0, 4);
}

function buildMPlusCharacterQuery(candidates: MPlusZoneCandidate[]): string {
  const partitions = [1, 2, 3];
  const rankingFields = candidates.flatMap((candidate, candidateIndex) =>
    partitions.map(
      (partition) =>
        `z${candidateIndex}p${partition}: zoneRankings(zoneID: ${candidate.zoneID}, partition: ${partition})`,
    ),
  );

  return /* GraphQL */ `
    query(
      $name: String!
      $serverSlug: String!
      $serverRegion: String!
    ) {
      characterData {
        character(
          name: $name
          serverSlug: $serverSlug
          serverRegion: $serverRegion
        ) {
          name
          ${rankingFields.join('\n          ')}
        }
      }
    }
  `;
}

const REPORT_TABLES_QUERY = /* GraphQL */ `
  query($code: String!, $fightID: Int!, $startTime: Int!, $endTime: Int!) {
    reportData {
      report(code: $code) {
        interrupts: table(
          fightIDs: [$fightID]
          startTime: $startTime
          endTime: $endTime
          dataType: Interrupts
        )
      }
    }
  }
`;

const REPORT_FIGHT_WINDOW_QUERY = /* GraphQL */ `
  query($code: String!, $fightID: Int!) {
    reportData {
      report(code: $code) {
        fights(fightIDs: [$fightID]) {
          id
          startTime
          endTime
        }
      }
    }
  }
`;

interface MPlusRankingCandidate {
  encounterName: string;
  reportCode: string;
  fightID: number;
  zoneID: number;
  zoneName: string;
  partition: number;
  totalKills: number;
  nameScore: number;
}

const CC_SPELL_KEYWORDS = [
  'stun',
  'fear',
  'blind',
  'incapac',
  'paralysis',
  'bash',
  'sweep',
  'freeze',
  'trap',
  'hibernate',
  'polymorph',
  'repentance',
  'imprison',
  'sap',
  'sleep walk',
  'silence',
  'beam',
  'nova',
  'shockwave',
  'disorient',
  'hex',
];

function flattenEntries(entries: WCLTableEntry[]): WCLTableEntry[] {
  return entries.flatMap((entry) => [entry, ...flattenEntries(entry.entries ?? [])]);
}

function findCharacterEntry(table: WCLTableScalar, characterName: string): WCLTableEntry | undefined {
  const target = characterName.toLowerCase();
  return flattenEntries(table.data?.entries ?? []).find(
    (entry) => entry.name?.toLowerCase() === target,
  );
}

function sumTotals(entries: WCLTableEntry[]): number {
  return entries.reduce(
    (sum, entry) => sum + (entry.total ?? 0) + sumTotals(entry.entries ?? []),
    0,
  );
}

function extractCrowdControlTotal(table: WCLTableScalar, characterName: string): number | null {
  const characterEntry = findCharacterEntry(table, characterName);
  if (!characterEntry) return null;

  const spellEntries = flattenEntries(characterEntry.entries ?? []);
  if (!spellEntries.length) return characterEntry.total ?? null;

  const matchingEntries = spellEntries.filter((entry) => {
    const name = normalize(entry.name ?? '');
    return CC_SPELL_KEYWORDS.some((keyword) => name.includes(keyword));
  });

  if (!matchingEntries.length) return 0;
  return sumTotals(matchingEntries);
}

function extractTableTotal(table: WCLTableScalar, characterName: string): number {
  return findCharacterEntry(table, characterName)?.total ?? 0;
}

async function fetchFightWindow(
  token: string,
  code: string,
  fightID: number,
): Promise<{ startTime: number; endTime: number } | null> {
  const data = await gqlQuery<ReportFightWindowResult>(token, REPORT_FIGHT_WINDOW_QUERY, {
    code,
    fightID,
  });

  const fight = data.reportData?.report?.fights?.find((entry) => entry.id === fightID)
    ?? data.reportData?.report?.fights?.[0];

  if (!fight || fight.startTime == null || fight.endTime == null) {
    return null;
  }

  return {
    startTime: fight.startTime,
    endTime: fight.endTime,
  };
}

function pickBestRankingCandidate(
  rankings: MPlusRankingCandidate[],
  run: RaiderIOBestRun,
): MPlusRankingCandidate | null {
  if (!rankings.length) return null;

  const aliases = buildDungeonAliases(run);

  return rankings
    .sort((a, b) => {
      const aScore = a.nameScore + (aliases.some((alias) => normalize(a.encounterName).includes(alias)) ? 20 : 0);
      const bScore = b.nameScore + (aliases.some((alias) => normalize(b.encounterName).includes(alias)) ? 20 : 0);
      return bScore - aScore || b.totalKills - a.totalKills || a.partition - b.partition;
    })[0];
}

/**
 * Two-step PUG Vetting fetch:
 *
 * Step A — Discovers the M+ season zone in WCL worldData, queries the
 *           character's M+ rankings for that zone, and fuzzy-matches the
 *           Raider.io dungeon name to find the right WCL reportCode + fightID.
 *
 * Step B — Uses that report's code and fightID to pull Interrupts, Deaths,
 *           and DamageTaken event table aggregates, filtered to this character.
 */
export async function fetchRunMetrics(
  characterName: string,
  realm: string,
  region: Region,
  run: RaiderIOBestRun,
): Promise<PugVettingResult> {
  const token = await fetchWCLToken();
  const serverSlug = realm.trim().toLowerCase().replace(/'/g, '').replace(/\s+/g, '-');
  const serverRegion = region.toUpperCase();

  // ── Step A ──────────────────────────────────────────────────────────────────
  const zoneCandidates = await findMPlusZonesForDungeon(token, run);
  if (!zoneCandidates.length) {
    return { success: false, reason: 'no_log_found' };
  }

  const charQuery = buildMPlusCharacterQuery(zoneCandidates);
  const charData = await gqlQuery<CharMPlusResult>(token, charQuery, {
    name: characterName,
    serverSlug,
    serverRegion,
  });

  const character = charData.characterData?.character;
  if (!character) {
    throw new Error(
      `"${characterName}" on ${realm} (${serverRegion}) was not found on Warcraft Logs.`,
    );
  }

  const aliases = buildDungeonAliases(run);
  const rankingCandidates: MPlusRankingCandidate[] = [];

  zoneCandidates.forEach((candidate, candidateIndex) => {
    [1, 2, 3].forEach((partition) => {
      const alias = `z${candidateIndex}p${partition}`;
      const result = character[alias] as WCLZoneRankings | null | undefined;
      const rankings = result?.rankings ?? [];

      rankings.forEach((ranking) => {
        if (!ranking.report?.code) return;
        const nameScore = dungeonNameScore(aliases, ranking.encounter.name);
        if (nameScore < 20) return;

        rankingCandidates.push({
          encounterName: ranking.encounter.name,
          reportCode: ranking.report.code,
          fightID: ranking.report.fightID,
          zoneID: candidate.zoneID,
          zoneName: candidate.zoneName,
          partition,
          totalKills: ranking.totalKills ?? 0,
          nameScore,
        });
      });
    });
  });

  const matched = pickBestRankingCandidate(rankingCandidates, run);
  if (!matched) {
    return { success: false, reason: 'no_log_found' };
  }

  // ── Step B ──────────────────────────────────────────────────────────────────
  try {
    const fightWindow = await fetchFightWindow(token, matched.reportCode, matched.fightID);
    if (!fightWindow) {
      throw new Error('Fight window unavailable');
    }

    const relativeStart = 0;
    const relativeEnd = Math.floor(run.clear_time_ms / 1000) * 1000 + 1000;

    const tables = await gqlQuery<ReportTablesResult>(token, REPORT_TABLES_QUERY, {
      code: matched.reportCode,
      fightID: matched.fightID,
      startTime: relativeStart,
      endTime: relativeEnd,
    });
    const report = tables.reportData?.report;

    if (!report) {
      throw new Error('Report tables unavailable');
    }

    const safeExtractNumber = (extractor: () => number | null): number => {
      try {
        return extractor() ?? 0;
      } catch {
        return 0;
      }
    };

    return {
      success: true,
      reportCode: matched.reportCode,
      fightID: matched.fightID,
      matchedDungeon: matched.encounterName,
      metrics: {
        interrupts: safeExtractNumber(() => extractTableTotal(report.interrupts, characterName)),
        cc: 0,
        avoidableDamageTaken: 0,
        deaths: 0,
      },
    };
  } catch (error) {
    console.error('[PUG Vetting] Step B failed', error);
    return {
      success: true,
      reportCode: matched.reportCode,
      fightID: matched.fightID,
      matchedDungeon: matched.encounterName,
      metrics: { interrupts: 0, cc: 0, avoidableDamageTaken: 0, deaths: 0 },
    };
  }
}
