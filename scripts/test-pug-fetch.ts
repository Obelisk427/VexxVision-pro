// scripts/test-pug-fetch.ts
// Run with: npx tsx scripts/test-pug-fetch.ts

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

  // Test: Soultactix on Illidan, zone 47 (Mythic+ Season 1 - Midnight)
  const query = `query {
    characterData {
      character(name: "Soultactix", serverSlug: "illidan", serverRegion: "US") {
        p1: zoneRankings(zoneID: 47, partition: 1, timeframe: Historical)
        p2: zoneRankings(zoneID: 47, partition: 2, timeframe: Historical)
        p3: zoneRankings(zoneID: 47, partition: 3, timeframe: Historical)
        p1current: zoneRankings(zoneID: 47, partition: 1)
        p2current: zoneRankings(zoneID: 47, partition: 2)
        p3current: zoneRankings(zoneID: 47, partition: 3)
      }
    }
  }`;

  const res = await fetch(WCL_GQL_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const json = await res.json();

  if (json.errors) {
    console.error('❌ GraphQL errors:', JSON.stringify(json.errors, null, 2));
    return;
  }

  const char = json.data.characterData.character;

  console.log('═══ Historical partition 1 ═══');
  console.log('Rankings count:', char.p1?.rankings?.length ?? 'null');
  if (char.p1?.rankings?.length > 0) {
    for (const r of char.p1.rankings.slice(0, 3)) {
      console.log(`  ${r.encounter.name} — ${r.rankPercent}% — report: ${r.report?.code ?? 'NONE'}`);
    }
  }

  console.log('\n═══ Historical partition 2 ═══');
  console.log('Rankings count:', char.p2?.rankings?.length ?? 'null');

  console.log('\n═══ Historical partition 3 ═══');
  console.log('Rankings count:', char.p3?.rankings?.length ?? 'null');

  console.log('\n═══ Current (no Historical) partition 1 ═══');
  console.log('Rankings count:', char.p1current?.rankings?.length ?? 'null');
  if (char.p1current?.rankings?.length > 0) {
    for (const r of char.p1current.rankings.slice(0, 3)) {
      console.log(`  ${r.encounter.name} — ${r.rankPercent}% — report: ${r.report?.code ?? 'NONE'}`);
    }
  }

  console.log('\n═══ Current (no Historical) partition 2 ═══');
  console.log('Rankings count:', char.p2current?.rankings?.length ?? 'null');

  console.log('\n═══ Current (no Historical) partition 3 ═══');
  console.log('Rankings count:', char.p3current?.rankings?.length ?? 'null');

  // Also dump the raw p1 response structure
  console.log('\n═══ RAW p1 Historical response ═══');
  console.log(JSON.stringify(char.p1, null, 2)?.slice(0, 2000));
}

main().catch(console.error);
