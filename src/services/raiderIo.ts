import type { RaiderIOProfile, RaiderIOBestRun, RaiderIOData, Region } from '../types';

const BASE_URL = 'https://raider.io/api/v1';

function toRealmSlug(realm: string): string {
  return realm.trim().toLowerCase().replace(/\s+/g, '-');
}

async function raiderIOFetch(
  name: string,
  slug: string,
  region: Region,
  fields: string,
): Promise<RaiderIOProfile> {
  const url = `${BASE_URL}/characters/profile?region=${region}&realm=${encodeURIComponent(slug)}&name=${encodeURIComponent(name)}&fields=${fields}`;
  const response = await fetch(url);

  if (!response.ok) {
    if (response.status === 400 || response.status === 404) {
      throw new Error(
        `Character "${name}" on "${slug}" (${region.toUpperCase()}) was not found on Raider.io.`,
      );
    }
    throw new Error(`Raider.io API error: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as RaiderIOProfile;
}

/**
 * Two-step Raider.io fetch:
 *
 * Step 1 — Fetches the character profile including both current + previous
 *           season scores and the current season's best runs.
 *
 * Step 2 — Extracts the previous season slug from Step 1's response
 *           (e.g., "season-tww-2"), then makes a second request with
 *           `mythic_plus_best_runs:{slug}` to retrieve the actual run history
 *           for that past season.
 */
export async function fetchRaiderIOData(
  name: string,
  realm: string,
  region: Region,
): Promise<RaiderIOData> {
  const slug = toRealmSlug(realm);

  // ── Step 1 ──────────────────────────────────────────────────────────────────
  const profile = await raiderIOFetch(
    name,
    slug,
    region,
    'mythic_plus_scores_by_season:current:previous,mythic_plus_best_runs',
  );

  const currentRuns: RaiderIOBestRun[] = profile.mythic_plus_best_runs ?? [];

  // Extract the previous season slug (e.g., "season-tww-2")
  const seasons = profile.mythic_plus_scores_by_season ?? [];
  const previousSeasonSlug = seasons[1]?.season ?? null;

  if (!previousSeasonSlug) {
    // Character has no recorded previous season — return with empty previous runs
    return { profile, currentRuns, previousRuns: [] };
  }

  // ── Step 2 ──────────────────────────────────────────────────────────────────
  // Fetch previous season runs using the dynamically extracted slug.
  // A failure here is non-fatal; we just return empty previous runs.
  let previousRuns: RaiderIOBestRun[] = [];
  try {
    const prevProfile = await raiderIOFetch(
      name,
      slug,
      region,
      `mythic_plus_best_runs:${previousSeasonSlug}`,
    );
    previousRuns = prevProfile.mythic_plus_best_runs ?? [];
  } catch {
    // Soft failure — previous runs unavailable, show empty table
  }

  return { profile, currentRuns, previousRuns };
}
