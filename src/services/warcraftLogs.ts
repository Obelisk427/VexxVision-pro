import type {
  Region,
  WCLZone,
  WCLZoneRankings,
  WCLRaidData,
  WCLBothTiersData,
  ProcessedBossData,
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
 * Queries all 6 combinations (Mythic/Heroic × Partitions 1/2/3) in a single
 * request using GraphQL field aliases, minimising round-trips.
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
        mythic: zoneRankings(zoneID: $zoneID, difficulty: 5)
        heroic: zoneRankings(zoneID: $zoneID, difficulty: 4)
      }
    }
  }
`;

interface CharRankingsResult {
  characterData: {
    character: {
      name: string;
      mythic: WCLZoneRankings;
      heroic: WCLZoneRankings;
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
  // WCL serverSlug is lowercase-hyphenated; serverRegion is uppercase (US/EU)
  const serverSlug = realm.trim().toLowerCase().replace(/\s+/g, '-');
  const serverRegion = region.toUpperCase();

  const data = await gqlQuery<CharRankingsResult>(token, CHARACTER_RANKINGS_QUERY, {
    name,
    serverSlug,
    serverRegion,
    zoneID: zone.id,
  });

  const character = data.characterData?.character;

  if (!character) {
    throw new Error(
      `Character "${name}" on "${realm}" (${serverRegion}) was not found on Warcraft Logs.`,
    );
  }

  /**
   * For each boss in the zone's encounter list, look up the character's best
   * kill in each difficulty from the WCL-merged rankings object.
   * WCL already picks the best partition when `partition` is omitted from the query.
   */
  function pickBestRank(
    rankings: WCLZoneRankings | null | undefined,
    encounterId: number,
  ): { rankPercent: number; kills: number; spec: string; fastestKill: number } | null {
    const r = rankings?.rankings?.find((row) => row.encounter?.id === encounterId);
    if (!r || (r.kills?.count ?? 0) === 0) return null;
    return {
      rankPercent: r.rankPercent,
      kills: r.kills?.count ?? 0,
      spec: r.spec ?? '',
      fastestKill: r.fastestKill ?? 0,
    };
  }

  const bosses: ProcessedBossData[] = zone.encounters.map((encounter) => {
    const mythic = pickBestRank(character.mythic, encounter.id);
    const heroic = pickBestRank(character.heroic, encounter.id);

    return {
      encounterId: encounter.id,
      encounterName: encounter.name,
      mythic: {
        rankPercent: mythic?.rankPercent ?? null,
        kills: mythic?.kills ?? null,
        spec: mythic?.spec ?? null,
        fastestKill: mythic?.fastestKill ?? null,
      },
      heroic: {
        rankPercent: heroic?.rankPercent ?? null,
        kills: heroic?.kills ?? null,
        spec: heroic?.spec ?? null,
        fastestKill: heroic?.fastestKill ?? null,
      },
    };
  });

  return { characterName: character.name, zone, bosses };
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
