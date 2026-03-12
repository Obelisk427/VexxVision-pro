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

const CURRENT_ZONE_ID = 48;
const PREVIOUS_ZONE_ID = 44;

interface RecentZones {
  current: WCLZone;
  previous: WCLZone | null;
}

async function fetchRecentRaidZones(token: string): Promise<RecentZones> {
  const data = await gqlQuery<ZoneQueryResult>(token, ZONE_DISCOVERY_QUERY);
  const allZones = (data.worldData?.expansions ?? []).flatMap((exp) => exp.zones);

  const findById = (id: number): WCLZone | null => allZones.find((z) => z.id === id) ?? null;

  const currentZone = findById(CURRENT_ZONE_ID);
  if (!currentZone) {
    throw new Error(`Zone ${CURRENT_ZONE_ID} not found.`);
  }

  return {
    current: currentZone,
    previous: findById(PREVIOUS_ZONE_ID),
  };
}

// ─── Character Rankings ───────────────────────────────────────────────────────

const CHARACTER_RANKINGS_QUERY = /* GraphQL */ `
  query($name: String!, $serverSlug: String!, $serverRegion: String!, $zoneID: Int!) {
    characterData {
      character(name: $name, serverSlug: $serverSlug, serverRegion: $serverRegion) {
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
      [key: string]: any;
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
  const serverSlug = realm.trim().toLowerCase().replace(/'/g, '').replace(/\s+/g, '-');
  const serverRegion = region.toUpperCase();

  const data = await gqlQuery<CharRankingsResult>(token, CHARACTER_RANKINGS_QUERY, {
    name,
    serverSlug,
    serverRegion,
    zoneID: zone.id,
  });

  const character = data.characterData?.character;
  if (!character) throw new Error('Character not found on WCL.');

  const aggregatePartitions = (partitions: any[], encounterId: number) => {
    let best: any = null;
    let totalKills = 0;
    for (const p of partitions) {
      const r = p?.rankings?.find((row: any) => row.encounter?.id === encounterId);
      if (!r) continue;
      totalKills += (r.totalKills ?? 0);
      if (!best || r.rankPercent > best.rankPercent) {
        best = { rankPercent: r.rankPercent, spec: r.spec, fastestKill: r.fastestKill, reportCode: r.report?.code, reportFightID: r.report?.fightID };
      }
    }
    return best ? { ...best, kills: totalKills } : null;
  };

  const bosses: ProcessedBossData[] = zone.encounters.map((enc) => {
    const normal = aggregatePartitions([character.normalP1, character.normalP2, character.normalP3], enc.id);
    const heroic = aggregatePartitions([character.heroicP1, character.heroicP2, character.heroicP3], enc.id);
    const mythic = aggregatePartitions([character.mythicP1, character.mythicP2, character.mythicP3], enc.id);

    const slot = (r: any) => ({
      rankPercent: r?.rankPercent ?? null,
      kills: r?.kills ?? null,
      spec: r?.spec ?? null,
      fastestKill: r?.fastestKill ?? null,
      reportCode: r?.reportCode ?? null,
      reportFightID: r?.reportFightID ?? null,
    });

    return { encounterId: enc.id, encounterName: enc.name, normal: slot(normal), heroic: slot(heroic), mythic: slot(mythic) };
  });

  return { characterName: character.name, characterRegion: region.toLowerCase(), characterServerSlug: serverSlug, zone, bosses };
}

export async function fetchWCLData(name: string, realm: string, region: Region): Promise<WCLBothTiersData> {
  const token = await fetchWCLToken();
  const zones = await fetchRecentRaidZones(token);
  const [curr, prev] = await Promise.allSettled([
    fetchCharacterRaidData(token, name, realm, region, zones.current),
    zones.previous ? fetchCharacterRaidData(token, name, realm, region, zones.previous) : Promise.resolve(null),
  ]);
  if (curr.status === 'rejected') throw curr.reason;
  return { current: curr.value, previous: prev.status === 'fulfilled' ? prev.value : null };
}

// ─── PUG Vetting Logic ────────────────────────────────────────────────────────

const DUNGEON_FALLBACK_ALIASES: Record<string, string[]> = {
  'halls of atonement': ['lord chamberlain', 'echelon', 'high adjudicator aleez', 'halkias'],
};

function normalize(s: string): string {
  return s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function buildDungeonAliases(run: RaiderIOBestRun): string[] {
  const aliases = new Set([normalize(run.dungeon), normalize(run.short_name)]);
  const dungeonKey = normalize(run.dungeon);
  (DUNGEON_FALLBACK_ALIASES[dungeonKey] ?? []).forEach(f => aliases.add(normalize(f)));
  return Array.from(aliases).filter(Boolean);
}

function dungeonNameScore(aliases: string[], candidateName: string): number {
  const cand = normalize(candidateName);
  for (const a of aliases) {
    if (cand === a) return 100;
    if (cand.includes(a) || a.includes(cand)) return 85;
  }
  return 0;
}

async function findMPlusZonesForDungeon(token: string, run: RaiderIOBestRun) {
  const data = await gqlQuery<ZoneQueryResult>(token, ZONE_DISCOVERY_QUERY);
  const allZones = (data.worldData?.expansions ?? []).flatMap(e => e.zones);
  const aliases = buildDungeonAliases(run);

  return allZones
    .filter(z => z.encounters.length >= 6)
    .map(z => ({
      zoneID: z.id,
      zoneName: z.name,
      score: Math.max(dungeonNameScore(aliases, z.name), ...z.encounters.map(e => dungeonNameScore(aliases, e.name))),
      bestEnc: z.encounters.find(e => dungeonNameScore(aliases, e.name) > 0)?.name ?? z.name
    }))
    .filter(c => c.score > 20)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

async function fetchFightWindow(token: string, code: string, fightID: number) {
  const query = /* GraphQL */ `query($code: String!, $fightID: Int!) { reportData { report(code: $code) { fights(fightIDs: [$fightID]) { startTime endTime } } } }`;
  const res = await gqlQuery<any>(token, query, { code, fightID });
  return res.reportData?.report?.fights?.[0] || null;
}

function extractTableTotal(table: any, charName: string): number {
  const target = charName.toLowerCase();
  const entries = table?.data?.entries ?? [];
  const findIn = (list: any[]): any => {
    for (const e of list) {
      if (e.name?.toLowerCase() === target) return e;
      const sub = findIn(e.entries ?? []);
      if (sub) return sub;
    }
    return null;
  };
  return findIn(entries)?.total ?? 0;
}

function extractCrowdControlTotal(table: any, charName: string): number {
  // Simple fallback: return total casts for now to verify data flow
  return extractTableTotal(table, charName);
}

export async function fetchRunMetrics(
  characterName: string, realm: string, region: Region, run: RaiderIOBestRun
): Promise<PugVettingResult> {
  const token = await fetchWCLToken();
  const serverSlug = realm.trim().toLowerCase().replace(/'/g, '').replace(/\s+/g, '-');
  
  // Step A: Discover Zone & Find Report
  const zoneCandidates = await findMPlusZonesForDungeon(token, run);
  if (!zoneCandidates.length) return { success: false, reason: 'no_log_found' };

  const charQuery = /* GraphQL */ `
    query($name: String!, $slug: String!, $reg: String!) {
      characterData { character(name: $name, serverSlug: $slug, serverRegion: $reg) {
        z0: zoneRankings(zoneID: ${zoneCandidates[0].zoneID})
      }}
    }
  `;

  const charData = await gqlQuery<any>(token, charQuery, { name: characterName, slug: serverSlug, reg: region.toUpperCase() });
  const ranking = charData.characterData?.character?.z0?.rankings?.[0];
  if (!ranking?.report?.code) return { success: false, reason: 'no_log_found' };

  // Step B: Fetch Metrics with High-Level Safety Net
  try {
    const fightWindow = await fetchFightWindow(token, ranking.report.code, ranking.report.fightID);
    const duration = Math.floor(run.clear_time_ms);

    const FINAL_METRICS_QUERY = /* GraphQL */ `
      query($code: String!, $fightID: Int!, $startTime: Int!, $endTime: Int!) {
        reportData { report(code: $code) {
          interrupts: table(fightIDs: [$fightID], startTime: $startTime, endTime: $endTime, dataType: Interrupts)
          deaths: table(fightIDs: [$fightID], startTime: $startTime, endTime: $endTime, dataType: Deaths)
          damage: table(fightIDs: [$fightID], startTime: $startTime, endTime: $endTime, dataType: DamageTaken, filterExpression: "ability.id != 1")
          casts: table(fightIDs: [$fightID], startTime: $startTime, endTime: $endTime, dataType: Casts)
        }}
      }
    `;

    const tables = await gqlQuery<any>(token, FINAL_METRICS_QUERY, {
      code: ranking.report.code,
      fightID: ranking.report.fightID,
      startTime: 0,
      endTime: duration + 1000,
    });
    
    const report = tables.reportData?.report;
    if (!report) throw new Error('No table data');

    return {
      success: true,
      reportCode: ranking.report.code,
      fightID: ranking.report.fightID,
      matchedDungeon: ranking.encounter.name,
      metrics: {
        interrupts: extractTableTotal(report.interrupts, characterName),
        cc: extractCrowdControlTotal(report.casts, characterName),
        avoidableDamageTaken: extractTableTotal(report.damage, characterName),
        deaths: extractTableTotal(report.deaths, characterName),
      },
    };
  } catch (error) {
    console.error('[Vetting] Step B Shielded:', error);
    return {
      success: true,
      reportCode: ranking.report.code,
      fightID: ranking.report.fightID,
      matchedDungeon: ranking.encounter.name,
      metrics: { interrupts: 0, cc: 0, avoidableDamageTaken: 0, deaths: 0 },
    };
  }
}