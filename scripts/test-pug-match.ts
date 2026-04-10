// scripts/test-pug-match.ts
// Run with: npx tsx scripts/test-pug-match.ts

import dotenv from 'dotenv';
dotenv.config();

const WCL_TOKEN_URL = 'https://www.warcraftlogs.com/oauth/token';
const WCL_GQL_URL = 'https://www.warcraftlogs.com/api/v2/client';

const normalize = (s: string) =>
  s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

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

  // Midnight S1 dungeon pool from Raider.IO
  const dungeons = [
    { dungeon: 'Nexus-Point Xenas', short_name: 'NPX' },
    { dungeon: "Seat of the Triumvirate", short_name: 'SEAT' },
    { dungeon: 'Skyreach', short_name: 'SKY' },
    { dungeon: 'Maisara Caverns', short_name: 'MC' },
    { dungeon: "Magisters' Terrace", short_name: 'MT' },
    { dungeon: 'Windrunner Spire', short_name: 'WS' },
    { dungeon: 'Pit of Saron', short_name: 'POS' },
    { dungeon: "Algeth'ar Academy", short_name: 'AA' },
  ];

  // Get all WCL zones + encounters
  const query = `query { worldData { expansions { zones { id name encounters { id name } } } } }`;
  const res = await fetch(WCL_GQL_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const json = await res.json();
  const allZones = json.data.worldData.expansions.flatMap((e: any) => e.zones);

  console.log('═'.repeat(60));
  console.log('DUNGEON MATCHING REPORT');
  console.log('═'.repeat(60));

  for (const d of dungeons) {
    const aliases = [normalize(d.dungeon), normalize(d.short_name)].filter(Boolean);
    console.log(`\n🎯 "${d.dungeon}" (short: ${d.short_name})`);
    console.log(`   Normalized aliases: ${JSON.stringify(aliases)}`);

    const matches = allZones.filter((z: any) =>
      z.encounters.some((enc: any) =>
        aliases.some(a => normalize(enc.name).includes(a) || a.includes(normalize(enc.name)))
      )
    ).sort((a: any, b: any) => b.id - a.id).slice(0, 3);

    if (matches.length === 0) {
      console.log('   ❌ NO MATCHING ZONES FOUND');
    } else {
      for (const m of matches) {
        const matchedEnc = m.encounters.filter((enc: any) =>
          aliases.some((a: string) => normalize(enc.name).includes(a) || a.includes(normalize(enc.name)))
        );
        console.log(`   ✅ Zone ${m.id} "${m.name}" → matched encounters: ${matchedEnc.map((e: any) => e.name).join(', ')}`);
      }
    }
  }
}

main().catch(console.error);