import type {
  Region,
  WCLZone,
  WCLZoneRankings,
  WCLRaidData,
  WCLBothTiersData,
  BossRankData,
  ProcessedBossData,
  PugVettingMetrics,
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
  name: string;
  id: number;
  total: number;
}
interface WCLTableScalar {
  data?: { entries?: WCLTableEntry[] };
}

interface CharMPlusResult {
  characterData: {
    character: {
      name: string;
      mPlusRankings: {
        rankings: Array<{
          encounter: { id: number; name: string };
          report: { code: string; fightID: number } | null;
          totalKills: number | null;
        }> | null;
      } | null;
    } | null;
  };
}

interface ReportTablesResult {
  reportData: {
    report: {
      interrupts:   WCLTableScalar;
      deaths:       WCLTableScalar;
      damageTaken:  WCLTableScalar;
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
async function findMPlusZoneForDungeon(
  token: string,
  dungeonName: string,
): Promise<number | null> {
  const data = await gqlQuery<ZoneQueryResult>(token, ZONE_DISCOVERY_QUERY);
  const allZones = (data.worldData?.expansions ?? []).flatMap((e) => e.zones);

  // All M+ season zones (any zone whose name contains "season" or "mythic+" and has 6+ encounters)
  const mPlusZones = allZones
    .filter((z) => {
      const lower = z.name.toLowerCase();
      return (lower.includes('season') || lower.includes('mythic+')) && z.encounters.length >= 6;
    })
    .sort((a, b) => b.id - a.id); // newest first

  if (!mPlusZones.length) {
    console.warn(
      '[PUG Vetting] No M+ zones found at all. All WCL zones:',
      allZones.map((z) => `[${z.id}] "${z.name}" (${z.encounters.length} enc)`),
    );
    return null;
  }

  console.log(
    '[PUG Vetting] M+ zone candidates (newest first):',
    mPlusZones.map((z) => `[${z.id}] "${z.name}" (${z.encounters.length} enc)`),
  );

  const targetNorm = normalize(dungeonName);

  for (const zone of mPlusZones) {
    const hit = zone.encounters.find((enc) => {
      const encNorm = normalize(enc.name);
      return encNorm === targetNorm || encNorm.includes(targetNorm) || targetNorm.includes(encNorm);
    });
    if (hit) {
      console.log(
        `[PUG Vetting] Dungeon "${dungeonName}" found in zone [${zone.id}] "${zone.name}"` +
        ` (encounter: "${hit.name}")`,
      );
      return zone.id;
    }
  }

  console.warn(
    `[PUG Vetting] Could not find dungeon "${dungeonName}" in any M+ zone encounter list.`,
    mPlusZones.flatMap((z) => z.encounters.map((e) => e.name)),
  );
  return null;
}

/**
 * Strips punctuation, collapses whitespace, lowercases — so
 * "Tazavesh: Streets of Wonder" ≡ "tazavesh streets of wonder".
 */
function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

const MPLUS_CHAR_QUERY = /* GraphQL */ `
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
        mPlusRankings: zoneRankings(zoneID: $zoneID)
      }
    }
  }
`;

const REPORT_TABLES_QUERY = /* GraphQL */ `
  query($code: String!, $fightID: Int!) {
    reportData {
      report(code: $code) {
        interrupts:  table(fightIDs: [$fightID], dataType: Interrupts)
        deaths:      table(fightIDs: [$fightID], dataType: Deaths)
        damageTaken: table(fightIDs: [$fightID], dataType: DamageTaken)
      }
    }
  }
`;

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
): Promise<PugVettingMetrics> {
  const token = await fetchWCLToken();
  const serverSlug = realm.trim().toLowerCase().replace(/'/g, '').replace(/\s+/g, '-');
  const serverRegion = region.toUpperCase();

  // ── Step A ──────────────────────────────────────────────────────────────────
  const zoneID = await findMPlusZoneForDungeon(token, run.dungeon);

  if (!zoneID) {
    throw new Error(
      'Could not identify the current M+ season zone on Warcraft Logs. ' +
      'Zone data may not be published yet.',
    );
  }

  const charData = await gqlQuery<CharMPlusResult>(token, MPLUS_CHAR_QUERY, {
    name: characterName,
    serverSlug,
    serverRegion,
    zoneID,
  });
  console.log('WCL M+ Rankings:', JSON.stringify(charData, null, 2));

  const character = charData.characterData?.character;
  if (!character) {
    throw new Error(
      `"${characterName}" on ${realm} (${serverRegion}) was not found on Warcraft Logs.`,
    );
  }

  const rankings = character.mPlusRankings?.rankings ?? [];

  // ── Diagnostic output ─────────────────────────────────────────────────
  console.log('[PUG Vetting] Attempting to match RIO run:', run.dungeon, 'Level:', run.mythic_level);
  console.log('[PUG Vetting] WCL returned', rankings.length, 'M+ ranking entries:');
  rankings.forEach((r) =>
    console.log(
      `  encounter=[${r.encounter.id}] "${r.encounter.name}"`,
      r.report?.code ? `reportCode=${r.report.code} fightID=${r.report.fightID}` : 'NO REPORT',
    ),
  );
  // ─────────────────────────────────────────────────────────────────

  if (!rankings.length) {
    throw new Error(
      'No Mythic+ logs found for this character. ' +
      'Make sure their runs have been logged to Warcraft Logs.',
    );
  }

  // Normalised fuzzy-match: strip punctuation so e.g.
  // "Tazavesh: Streets of Wonder" ≡ "tazavesh streets of wonder"
  const targetNorm = normalize(run.dungeon);
  console.log('[PUG Vetting] Normalized target:', targetNorm);

  const matched = rankings.find((r) => {
    const wclNorm = normalize(r.encounter.name);
    const hit = wclNorm === targetNorm || wclNorm.includes(targetNorm) || targetNorm.includes(wclNorm);
    console.log(`  compare "${wclNorm}" vs "${targetNorm}" → ${hit ? 'MATCH ✓' : 'no'}`);
    return hit;
  });

  if (!matched) {
    throw new Error(
      `No dungeon ranking found for "${run.dungeon}" in the M+ season zone. ` +
      'Check DevTools console for the full list of WCL encounter names.',
    );
  }
  if (!matched.report?.code) {
    throw new Error(
      `Found "${matched.encounter.name}" on WCL but it has no linked report. ` +
      `+${run.mythic_level} run may not have been logged to Warcraft Logs.`,
    );
  }

  const { code, fightID } = matched.report;

  // ── Step B ──────────────────────────────────────────────────────────────────
  const tables = await gqlQuery<ReportTablesResult>(token, REPORT_TABLES_QUERY, {
    code,
    fightID,
  });
  console.log('WCL Report Tables:', JSON.stringify(tables, null, 2));

  const report = tables.reportData?.report;
  if (!report) {
    throw new Error(`Report "${code}" could not be fetched from Warcraft Logs.`);
  }

  // Extract character-specific totals (case-insensitive name match)
  const findEntry = (table: WCLTableScalar): WCLTableEntry | undefined =>
    (table.data?.entries ?? []).find(
      (e) => e.name.toLowerCase() === characterName.toLowerCase(),
    );

  return {
    interrupts:           findEntry(report.interrupts)?.total   ?? 0,
    cc:                   null,  // Phase 3: requires spell-ID event filtering
    avoidableDamageTaken: findEntry(report.damageTaken)?.total  ?? 0,
    deaths:               findEntry(report.deaths)?.total       ?? 0,
  };
}
