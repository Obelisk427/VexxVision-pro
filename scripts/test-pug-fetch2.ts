// scripts/test-pug-fetch2.ts
import dotenv from 'dotenv';
dotenv.config();

const WCL_TOKEN_URL = 'https://www.warcraftlogs.com/oauth/token';
const WCL_GQL_URL = 'https://www.warcraftlogs.com/api/v2/client';

async function main() {
  const clientId = process.env.VITE_WCL_CLIENT_ID;
  const clientSecret = process.env.VITE_WCL_CLIENT_SECRET;
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const tokenRes = await fetch(WCL_TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  const { access_token } = await tokenRes.json();
  console.log('✅ Token acquired\n');

  // Approach 1: Try characterRankings instead of zoneRankings
  const q1 = `query {
    characterData {
      character(name: "Soultactix", serverSlug: "illidan", serverRegion: "US") {
        npx: encounterRankings(encounterID: 12915, difficulty: 10)
        sky: encounterRankings(encounterID: 61209, difficulty: 10)
      }
    }
  }`;

  console.log('═══ Approach 1: encounterRankings ═══');
  const r1 = await fetch(WCL_GQL_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: q1 }),
  });
  const j1 = await r1.json();
  if (j1.errors) {
    console.log('Errors:', JSON.stringify(j1.errors, null, 2));
  } else {
    const c = j1.data.characterData.character;
    console.log('NPX:', JSON.stringify(c.npx, null, 2)?.slice(0, 1500));
    console.log('\nSKY:', JSON.stringify(c.sky, null, 2)?.slice(0, 1500));
  }

  // Approach 2: Try looking up reports directly for the character
  const q2 = `query {
    characterData {
      character(name: "Soultactix", serverSlug: "illidan", serverRegion: "US") {
        recentReports(limit: 5) {
          data {
            code
            title
            startTime
            endTime
            zone { id name }
            fights { id name encounterID difficulty kill }
          }
        }
      }
    }
  }`;

  console.log('\n═══ Approach 2: recentReports ═══');
  const r2 = await fetch(WCL_GQL_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: q2 }),
  });
  const j2 = await r2.json();
  if (j2.errors) {
    console.log('Errors:', JSON.stringify(j2.errors, null, 2));
  } else {
    const reports = j2.data.characterData.character.recentReports?.data ?? [];
    for (const rep of reports) {
      console.log(`\nReport: ${rep.code} — ${rep.title}`);
      console.log(`  Zone: ${rep.zone?.name ?? 'null'} (${rep.zone?.id ?? '?'})`);
      const dungeonFights = (rep.fights ?? []).filter((f: any) => f.difficulty === 10);
      for (const f of dungeonFights) {
        console.log(`  Fight ${f.id}: ${f.name} (enc: ${f.encounterID}, kill: ${f.kill})`);
      }
    }
  }
}

main().catch(console.error);