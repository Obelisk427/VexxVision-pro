// scripts/discover-zones.ts
// Run with: npx tsx scripts/discover-zones.ts

import dotenv from 'dotenv';
dotenv.config();

const WCL_TOKEN_URL = 'https://www.warcraftlogs.com/oauth/token';
const WCL_GQL_URL = 'https://www.warcraftlogs.com/api/v2/client';

async function main() {
  const clientId = process.env.VITE_WCL_CLIENT_ID;
  const clientSecret = process.env.VITE_WCL_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error('❌ Missing VITE_WCL_CLIENT_ID or VITE_WCL_CLIENT_SECRET in .env');
    process.exit(1);
  }

  // 1. Get token
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const tokenRes = await fetch(WCL_TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  const { access_token } = await tokenRes.json();
  console.log('✅ Token acquired\n');

  // 2. Query all expansions + zones
  const query = `query {
    worldData {
      expansions {
        id
        name
        zones {
          id
          name
          encounters { id name }
        }
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
    process.exit(1);
  }

  const expansions = json.data.worldData.expansions;

  // 3. Print all expansions that have raid zones
  for (const exp of expansions) {
    const raidZones = exp.zones.filter((z: any) => (z.encounters?.length ?? 0) > 3);
    if (raidZones.length === 0) continue;

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`EXPANSION: ${exp.name} (id: ${exp.id})`);
    console.log('═'.repeat(60));
    for (const zone of exp.zones) {
      const encounterCount = zone.encounters?.length ?? 0;
      const type = encounterCount > 3 ? '🏰 RAID' : encounterCount === 1 ? '⚔️ M+' : `📦 OTHER (${encounterCount})`;
      console.log(`  ${type}: ${zone.name} (zoneID: ${zone.id}, ${encounterCount} enc)`);
      if (encounterCount > 3) {
        for (const enc of zone.encounters) {
          console.log(`    • ${enc.name} (id: ${enc.id})`);
        }
      }
    }
  }

  // 4. Summary: top 5 raid zones by ID (highest = most recent)
  const allRaidZones = expansions
    .flatMap((e: any) => e.zones)
    .filter((z: any) => (z.encounters?.length ?? 0) > 3)
    .sort((a: any, b: any) => b.id - a.id);

  console.log(`\n${'═'.repeat(60)}`);
  console.log('🎯 TOP 5 RAID ZONES BY ID (most recent first):');
  console.log('═'.repeat(60));
  for (const z of allRaidZones.slice(0, 5)) {
    console.log(`  zoneID: ${z.id} — ${z.name} (${z.encounters.length} bosses)`);
  }
}

main().catch(console.error);