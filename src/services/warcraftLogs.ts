import type { Region, WCLZone, WCLRaidData, WCLBothTiersData, ProcessedBossData, PugVettingResult, RaiderIOBestRun } from '../types';

console.log('>>> VEXX SYSTEM: HISTORICAL M+ TIMEFRAME UNLOCKED <<<');

const WCL_TOKEN_URL = 'https://www.warcraftlogs.com/oauth/token';
const WCL_GQL_URL = 'https://www.warcraftlogs.com/api/v2/client';

async function fetchWCLToken(): Promise<string> {
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

async function gqlQuery<T>(token: string, query: string, variables?: Record<string, unknown>): Promise<T> {
  const response = await fetch(WCL_GQL_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const json = await response.json();
  if (json.errors) throw new Error(json.errors[0].message);
  return json.data;
}

// ─── Raid Panel Support (INTACT) ─────────────────────────────────────────────

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
        rankPercent: r?.rankPercent ?? null, kills: r?.kills ?? null, spec: r?.spec ?? null, fastestKill: r?.fastestKill ?? null, reportCode: r?.reportCode ?? null, reportFightID: r?.reportFightID ?? null
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
  const current = await fetchSingleTier(token, name, realm, region, 48); 
  const previous = await fetchSingleTier(token, name, realm, region, 44); 
  if (!current) throw new Error("Character data could not be loaded.");
  return { current, previous };
}

// ─── PUG Vetting Support (HISTORICAL OVERRIDE) ─────────────────────────────

export async function fetchRunMetrics(characterName: string, realm: string, region: Region, run: RaiderIOBestRun): Promise<PugVettingResult> {
  const token = await fetchWCLToken();
  const serverSlug = realm.trim().toLowerCase().replace(/'/g, '').replace(/\s+/g, '-');
  
  const normalize = (s: string) => s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const aliases = [
    normalize(run.dungeon), 
    normalize(run.short_name), 
    ...(['halls of atonement'].includes(normalize(run.dungeon)) ? ['lord chamberlain', 'halkias'] : [])
  ].filter(Boolean);

  const zoneQuery = /* GraphQL */ `query { worldData { expansions { zones { id name encounters { id name } } } } }`;
  const zonesData = await gqlQuery<any>(token, zoneQuery);
  const allZones = zonesData.worldData.expansions.flatMap((e: any) => e.zones);
  
  const matchingZones = allZones.filter((z: any) => 
    z.encounters.some((enc: any) => aliases.some(a => normalize(enc.name).includes(a) || a.includes(normalize(enc.name))))
  ).sort((a: any, b: any) => b.id - a.id).slice(0, 3);

  if (!matchingZones.length) return { success: false, reason: 'no_log_found' };

  // THE FIX: Added "timeframe: Historical" to force WCL to look past the current week's affixes.
  const charQuery = /* GraphQL */ `
    query($n: String!, $s: String!, $r: String!) {
      characterData { character(name: $n, serverSlug: $s, serverRegion: $r) {
        ${matchingZones.map((z: any, i: number) => `
          z${i}p1: zoneRankings(zoneID: ${z.id}, partition: 1, timeframe: Historical)
          z${i}p2: zoneRankings(zoneID: ${z.id}, partition: 2, timeframe: Historical)
          z${i}p3: zoneRankings(zoneID: ${z.id}, partition: 3, timeframe: Historical)
        `).join('\n        ')}
      }}
    }
  `;

  const charData = await gqlQuery<any>(token, charQuery, { n: characterName, s: serverSlug, r: region.toUpperCase() });
  const char = charData.characterData?.character;
  
  const allRankings: any[] = [];
  matchingZones.forEach((_: any, i: number) => {
    allRankings.push(...(char?.[`z${i}p1`]?.rankings ?? []));
    allRankings.push(...(char?.[`z${i}p2`]?.rankings ?? []));
    allRankings.push(...(char?.[`z${i}p3`]?.rankings ?? []));
  });

  const bestMatch = allRankings.find(r => 
    aliases.some(a => normalize(r.encounter.name).includes(a) || a.includes(normalize(r.encounter.name)))
  );

  if (!bestMatch?.report?.code) return { success: false, reason: 'no_log_found' };

  try {
    const duration = Math.floor(run.clear_time_ms);
    const METRICS_QUERY = /* GraphQL */ `
      query($code: String!, $fightID: Int!, $end: Int!) {
        reportData { report(code: $code) {
          interrupts: table(fightIDs: [$fightID], startTime: 0, endTime: $end, dataType: Interrupts)
          damage: table(fightIDs: [$fightID], startTime: 0, endTime: $end, dataType: DamageTaken, filterExpression: "ability.id != 1")
          deaths: table(fightIDs: [$fightID], startTime: 0, endTime: $end, dataType: Deaths)
        }}
      }
    `;

    const tables = await gqlQuery<any>(token, METRICS_QUERY, { code: bestMatch.report.code, fightID: bestMatch.report.fightID, end: duration + 1000 });
    const report = tables.reportData?.report;
    
    const extract = (tab: any) => {
      if (!tab?.data?.entries) return 0;
      const entry = tab.data.entries.find((e: any) => normalize(e.name ?? '') === normalize(characterName));
      return entry?.total ?? 0;
    };

    return {
      success: true,
      reportCode: bestMatch.report.code,
      fightID: bestMatch.report.fightID,
      matchedDungeon: bestMatch.encounter.name,
      metrics: {
        interrupts: extract(report.interrupts),
        cc: 0,
        avoidableDamageTaken: extract(report.damage),
        deaths: extract(report.deaths),
      }
    };
  } catch (e) {
    return { success: true, reportCode: bestMatch.report.code, fightID: bestMatch.report.fightID, matchedDungeon: bestMatch.encounter.name, metrics: { interrupts: 0, cc: 0, avoidableDamageTaken: 0, deaths: 0 } };
  }
}