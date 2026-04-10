import type { Region, WCLRaidData, WCLBothTiersData, ProcessedBossData, PugVettingResult, RaiderIOBestRun } from '../types';

const WCL_TOKEN_URL = 'https://www.warcraftlogs.com/oauth/token';
const WCL_GQL_URL = 'https://www.warcraftlogs.com/api/v2/client';

// In production, VITE_ env vars are empty (secrets stay server-side).
// We detect this and route through /api/wcl instead.
const useProxy = !import.meta.env.VITE_WCL_CLIENT_ID;

// ─── Auth (local dev only) ───────────────────────────────────────────────────

async function fetchWCLToken(): Promise<string> {
  if (useProxy) return ''; // token handled server-side
  const clientId = import.meta.env.VITE_WCL_CLIENT_ID;
  const clientSecret = import.meta.env.VITE_WCL_CLIENT_SECRET;
  const credentials = btoa(`${clientId}:${clientSecret}`);
  const response = await fetch(WCL_TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  const json = await response.json();
  return json.access_token;
}

// ─── GraphQL (auto-routes: proxy in prod, direct in dev) ─────────────────────

async function gqlQuery<T>(token: string, query: string, variables?: Record<string, unknown>): Promise<T> {
  let response: Response;

  if (useProxy) {
    response = await fetch('/api/wcl', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
  } else {
    response = await fetch(WCL_GQL_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
  }

  const json = await response.json();
  if (json.errors) throw new Error(json.errors[0].message);
  if (json.error) throw new Error(json.error);
  return json.data;
}

// ─── Shared Utilities ────────────────────────────────────────────────────────

const normalize = (s: string) =>
  s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

const ZONE_NAME_BLOCKLIST = [
  'beta',
  'mythic+ beta',
  'complete raids',
  'delves',
  'torghast',
  'challenge modes',
  'blackrock depths',
];

function isBlockedZone(zoneName: string): boolean {
  const lower = zoneName.toLowerCase();
  return ZONE_NAME_BLOCKLIST.some((term) => lower.includes(term));
}

function isDungeonMatch(encNorm: string, dungeonNorm: string): boolean {
  if (encNorm === dungeonNorm) return true;
  if (dungeonNorm.length >= 4 && encNorm.includes(dungeonNorm)) return true;
  if (encNorm.length >= 4 && dungeonNorm.includes(encNorm)) return true;
  return false;
}

// ─── Dynamic Zone Discovery (Raids) ─────────────────────────────────────────

interface DiscoveredZone {
  id: number;
  name: string;
  encounterCount: number;
}

let _zoneCache: { current: number; previous: number } | null = null;

async function discoverRaidZones(token: string): Promise<{ current: number; previous: number }> {
  if (_zoneCache) return _zoneCache;

  const query = /* GraphQL */ `
    query {
      worldData {
        expansions {
          id
          name
          zones { id name encounters { id } }
        }
      }
    }
  `;

  const data = await gqlQuery<any>(token, query);
  const expansions: any[] = data.worldData.expansions;

  const sorted = [...expansions].sort((a, b) => b.id - a.id);
  const recent = sorted.slice(0, 2);

  const allZones: DiscoveredZone[] = recent.flatMap((exp) =>
    (exp.zones ?? []).map((z: any) => ({
      id: z.id,
      name: z.name,
      encounterCount: z.encounters?.length ?? 0,
    }))
  );

  const raidZones = allZones
    .filter((z) => z.encounterCount > 3)
    .filter((z) => !isBlockedZone(z.name))
    .filter((z) => !z.name.toLowerCase().startsWith('mythic+'))
    .sort((a, b) => b.id - a.id);

  if (raidZones.length < 1) {
    throw new Error('Dynamic zone discovery found no valid raid tiers. WCL data may have changed.');
  }

  const result = {
    current: raidZones[0].id,
    previous: raidZones[1]?.id ?? raidZones[0].id,
  };

  console.log(`[TactixVision] Dynamic zone discovery → current: ${result.current} (${raidZones[0].name}), previous: ${result.previous} (${raidZones[1]?.name ?? 'same'})`);

  _zoneCache = result;
  return result;
}

// ─── Raid Panel Support ──────────────────────────────────────────────────────

async function fetchSingleTier(token: string, name: string, realm: string, region: Region, zoneID: number): Promise<WCLRaidData | null> {
  const serverSlug = realm.trim().toLowerCase().replace(/'/g, '').replace(/\s+/g, '-');

  const query = /* GraphQL */ `
    query($n: String!, $s: String!, $r: String!, $z: Int!) {
      characterData { character(name: $n, serverSlug: $s, serverRegion: $r) {
        name
        normalP1: zoneRankings(zoneID: $z, difficulty: 3, partition: 1)
        normalP2: zoneRankings(zoneID: $z, difficulty: 3, partition: 2)
        normalP3: zoneRankings(zoneID: $z, difficulty: 3, partition: 3)
        heroicP1: zoneRankings(zoneID: $z, difficulty: 4, partition: 1)
        heroicP2: zoneRankings(zoneID: $z, difficulty: 4, partition: 2)
        heroicP3: zoneRankings(zoneID: $z, difficulty: 4, partition: 3)
        mythicP1: zoneRankings(zoneID: $z, difficulty: 5, partition: 1)
        mythicP2: zoneRankings(zoneID: $z, difficulty: 5, partition: 2)
        mythicP3: zoneRankings(zoneID: $z, difficulty: 5, partition: 3)
      }}
      worldData { zone(id: $z) { id name encounters { id name } } }
    }
  `;

  try {
    const data = await gqlQuery<any>(token, query, { n: name, s: serverSlug, r: region.toUpperCase(), z: zoneID });
    const char = data.characterData?.character;
    const zoneData = data.worldData?.zone;
    const encounters = zoneData?.encounters ?? [];

    if (!char || !zoneData) return null;

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

    const bosses: ProcessedBossData[] = encounters.map((enc: any) => {
      const normal = aggregatePartitions([char.normalP1, char.normalP2, char.normalP3], enc.id);
      const heroic = aggregatePartitions([char.heroicP1, char.heroicP2, char.heroicP3], enc.id);
      const mythic = aggregatePartitions([char.mythicP1, char.mythicP2, char.mythicP3], enc.id);

      const slot = (r: any) => ({
        rankPercent: r?.rankPercent ?? null, kills: r?.kills ?? null, spec: r?.spec ?? null, fastestKill: r?.fastestKill ?? null, reportCode: r?.reportCode ?? null, reportFightID: r?.reportFightID ?? null,
      });

      return { encounterId: enc.id, encounterName: enc.name, normal: slot(normal), heroic: slot(heroic), mythic: slot(mythic) };
    });

    return { characterName: char.name, characterRegion: region.toLowerCase(), characterServerSlug: serverSlug, zone: { id: zoneData.id, name: zoneData.name, encounters }, bosses } as any;
  } catch {
    return null;
  }
}

export async function fetchWCLData(name: string, realm: string, region: Region): Promise<WCLBothTiersData> {
  const token = await fetchWCLToken();
  const zones = await discoverRaidZones(token);

  const [current, previous] = await Promise.all([
    fetchSingleTier(token, name, realm, region, zones.current),
    fetchSingleTier(token, name, realm, region, zones.previous),
  ]);

  if (!current) throw new Error('Character data could not be loaded.');
  return { current, previous };
}

// ─── PUG Vetting Support ────────────────────────────────────────────────────

export async function fetchRunMetrics(characterName: string, realm: string, region: Region, run: RaiderIOBestRun): Promise<PugVettingResult> {
  const token = await fetchWCLToken();
  const serverSlug = realm.trim().toLowerCase().replace(/'/g, '').replace(/\s+/g, '-');
  const dungeonNorm = normalize(run.dungeon);
  const charNorm = normalize(characterName);

  // ── Step 1: Find the WCL encounter ID for this dungeon ────────────────────
  const zoneQuery = /* GraphQL */ `query { worldData { expansions { zones { id name encounters { id name } } } } }`;
  const zonesData = await gqlQuery<any>(token, zoneQuery);
  const allZones: any[] = zonesData.worldData.expansions.flatMap((e: any) => e.zones);

  let matchedEncounterId: number | null = null;
  let matchedEncounterName: string | null = null;

  const sortedZones = allZones
    .filter((z: any) => !isBlockedZone(z.name))
    .sort((a: any, b: any) => b.id - a.id);

  for (const zone of sortedZones) {
    for (const enc of zone.encounters) {
      if (isDungeonMatch(normalize(enc.name), dungeonNorm)) {
        matchedEncounterId = enc.id;
        matchedEncounterName = enc.name;
        break;
      }
    }
    if (matchedEncounterId) break;
  }

  if (!matchedEncounterId) return { success: false, reason: 'no_log_found' };

  // ── Step 2: Use encounterRankings to get the report code ──────────────────
  const rankQuery = /* GraphQL */ `
    query($n: String!, $s: String!, $r: String!, $encID: Int!) {
      characterData {
        character(name: $n, serverSlug: $s, serverRegion: $r) {
          encounterRankings(encounterID: $encID, difficulty: 10)
        }
      }
    }
  `;

  const rankData = await gqlQuery<any>(token, rankQuery, {
    n: characterName,
    s: serverSlug,
    r: region.toUpperCase(),
    encID: matchedEncounterId,
  });

  const rankings = rankData.characterData?.character?.encounterRankings;
  const ranks: any[] = rankings?.ranks ?? [];
  const bestRank = ranks.find((r: any) => r.report?.code && r.report.code.length > 0);

  if (!bestRank?.report?.code) return { success: false, reason: 'no_log_found' };

  const reportCode = bestRank.report.code;
  const fightID = bestRank.report.fightID;

  // ── Step 3: Fetch the fight's actual start/end times ──────────────────────
  let fightStart: number;
  let fightEnd: number;

  try {
    const fightsData = await gqlQuery<any>(token, /* GraphQL */ `
      query($code: String!) {
        reportData {
          report(code: $code) {
            fights {
              id
              startTime
              endTime
            }
          }
        }
      }
    `, { code: reportCode });

    const fights: any[] = fightsData.reportData?.report?.fights ?? [];
    const targetFight = fights.find((f: any) => f.id === fightID);

    if (!targetFight) {
      return { success: true, reportCode, fightID, matchedDungeon: matchedEncounterName ?? run.dungeon, metrics: { interrupts: 0, dps: 0, damageTakenPercent: null, isTank: false, damageTakenRaw: 0, deaths: 0 } };
    }

    fightStart = targetFight.startTime;
    fightEnd = targetFight.endTime;
  } catch {
    return { success: true, reportCode, fightID, matchedDungeon: matchedEncounterName ?? run.dungeon, metrics: { interrupts: 0, dps: 0, damageTakenPercent: null, isTank: false, damageTakenRaw: 0, deaths: 0 } };
  }

  // ── Step 4: Fetch all metrics using the fight's real time window ───────────
  try {
    const METRICS_QUERY = /* GraphQL */ `
      query($code: String!, $fightID: Int!, $start: Float!, $end: Float!) {
        reportData { report(code: $code) {
          interrupts: table(fightIDs: [$fightID], startTime: $start, endTime: $end, dataType: Interrupts)
          damageDone: table(fightIDs: [$fightID], startTime: $start, endTime: $end, dataType: DamageDone)
          damageTaken: table(fightIDs: [$fightID], startTime: $start, endTime: $end, dataType: DamageTaken)
          deaths: table(fightIDs: [$fightID], startTime: $start, endTime: $end, dataType: Deaths)
        }}
      }
    `;

    const tables = await gqlQuery<any>(token, METRICS_QUERY, {
      code: reportCode,
      fightID,
      start: fightStart,
      end: fightEnd,
    });
    const report = tables.reportData?.report;
    const fightDurationSec = (fightEnd - fightStart) / 1000;

    // ── Extract interrupts ──────────────────────────────────────────────────
    const extractInterrupts = (tab: any): number => {
      if (!tab?.data?.entries) return 0;
      let total = 0;
      let abilityList: any[] = tab.data.entries;
      if (abilityList.length > 0 && abilityList[0].entries && !abilityList[0].name) {
        abilityList = abilityList[0].entries;
      }
      for (const ability of abilityList) {
        const details: any[] = ability.details ?? [];
        for (const player of details) {
          if (player.name && normalize(player.name) === charNorm) {
            total += player.total ?? 0;
          }
        }
      }
      return total;
    };

    // ── Extract DPS ─────────────────────────────────────────────────────────
    let charDps = 0;
    const dmgDoneEntries: any[] = report.damageDone?.data?.entries ?? [];
    for (const entry of dmgDoneEntries) {
      if (entry.name && normalize(entry.name) === charNorm) {
        charDps = fightDurationSec > 0 ? Math.round((entry.total ?? 0) / fightDurationSec) : 0;
        break;
      }
    }

    // ── Extract damage taken for ALL players + relative comparison ───────────
    const dmgTakenEntries: any[] = report.damageTaken?.data?.entries ?? [];
    const playerDamages: { name: string; total: number }[] = [];
    let charDamageTaken = 0;

    for (const entry of dmgTakenEntries) {
      if (entry.name) {
        playerDamages.push({ name: entry.name, total: entry.total ?? 0 });
        if (normalize(entry.name) === charNorm) {
          charDamageTaken = entry.total ?? 0;
        }
      }
    }

    const sortedByDmg = [...playerDamages].sort((a, b) => b.total - a.total);
    const tankName = sortedByDmg.length > 0 ? sortedByDmg[0].name : null;
    const isTank = tankName ? normalize(tankName) === charNorm : false;

    let damageTakenPercent: number | null = null;

    if (playerDamages.length > 0) {
      if (isTank) {
        const totalGroupDmg = playerDamages.reduce((sum, p) => sum + p.total, 0);
        damageTakenPercent = totalGroupDmg > 0 ? Math.round((charDamageTaken / totalGroupDmg) * 100) : 0;
      } else {
        const nonTankPlayers = playerDamages.filter(
          (p) => !tankName || normalize(p.name) !== normalize(tankName)
        );
        const nonTankAvg = nonTankPlayers.length > 0
          ? nonTankPlayers.reduce((sum, p) => sum + p.total, 0) / nonTankPlayers.length
          : 0;
        damageTakenPercent = nonTankAvg > 0 ? Math.round(((charDamageTaken - nonTankAvg) / nonTankAvg) * 100) : 0;
      }
    }

    // ── Extract deaths ──────────────────────────────────────────────────────
    const deathEntries: any[] = report.deaths?.data?.entries ?? [];
    const deathCount = deathEntries.filter(
      (e: any) => e.name && normalize(e.name) === charNorm
    ).length;

    return {
      success: true,
      reportCode,
      fightID,
      matchedDungeon: matchedEncounterName ?? run.dungeon,
      metrics: {
        interrupts: extractInterrupts(report.interrupts),
        dps: charDps,
        damageTakenPercent,
        isTank,
        damageTakenRaw: charDamageTaken,
        deaths: deathCount,
      },
    };
  } catch {
    return { success: true, reportCode, fightID, matchedDungeon: matchedEncounterName ?? run.dungeon, metrics: { interrupts: 0, dps: 0, damageTakenPercent: null, isTank: false, damageTakenRaw: 0, deaths: 0 } };
  }
}