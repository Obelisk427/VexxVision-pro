// scripts/test-metrics2.ts
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

  const code = '8K3XnZmv9kGTNHtP';
  const fightID = 11;

  // Use the fight's actual start/end from the report
  const fightStart = 150861447;
  const fightEnd = 152408433;

  const query = `query {
    reportData { report(code: "${code}") {
      interrupts: table(fightIDs: [${fightID}], startTime: ${fightStart}, endTime: ${fightEnd}, dataType: Interrupts)
      damage: table(fightIDs: [${fightID}], startTime: ${fightStart}, endTime: ${fightEnd}, dataType: DamageTaken)
      deaths: table(fightIDs: [${fightID}], startTime: ${fightStart}, endTime: ${fightEnd}, dataType: Deaths)
    }}
  }`;

  const res = await fetch(WCL_GQL_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const json = await res.json();

  if (json.errors) {
    console.log('❌ Errors:', JSON.stringify(json.errors, null, 2));
    return;
  }

  const r = json.data.reportData.report;

  console.log('═══ Interrupts ═══');
  for (const e of (r.interrupts?.data?.entries ?? [])) {
    console.log(`  ${e.name ?? 'unknown'}: ${e.total ?? 0}`);
  }

  console.log('\n═══ Damage Taken ═══');
  for (const e of (r.damage?.data?.entries ?? [])) {
    console.log(`  ${e.name ?? 'unknown'}: ${e.total ?? 0}`);
  }

  console.log('\n═══ Deaths ═══');
  for (const e of (r.deaths?.data?.entries ?? [])) {
    console.log(`  ${e.name ?? 'unknown'}: ${e.total ?? 0}`);
  }

  if ((r.interrupts?.data?.entries?.length ?? 0) === 0 &&
      (r.damage?.data?.entries?.length ?? 0) === 0) {
    console.log('\n⚠️ Still empty — trying without fightIDs filter...');
    const q2 = `query {
      reportData { report(code: "${code}") {
        interrupts: table(startTime: ${fightStart}, endTime: ${fightEnd}, dataType: Interrupts)
        damage: table(startTime: ${fightStart}, endTime: ${fightEnd}, dataType: DamageTaken)
        deaths: table(startTime: ${fightStart}, endTime: ${fightEnd}, dataType: Deaths)
      }}
    }`;
    const r2 = await fetch(WCL_GQL_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: q2 }),
    });
    const j2 = await r2.json();
    if (j2.errors) {
      console.log('Errors:', JSON.stringify(j2.errors, null, 2));
    } else {
      const rr = j2.data.reportData.report;
      console.log('\nInterrupts (no fightID filter):');
      for (const e of (rr.interrupts?.data?.entries ?? [])) {
        console.log(`  ${e.name ?? 'unknown'}: ${e.total ?? 0}`);
      }
      console.log('\nDamage (no fightID filter):');
      for (const e of (rr.damage?.data?.entries ?? [])) {
        console.log(`  ${e.name ?? 'unknown'}: ${e.total ?? 0}`);
      }
      console.log('\nDeaths (no fightID filter):');
      for (const e of (rr.deaths?.data?.entries ?? [])) {
        console.log(`  ${e.name ?? 'unknown'}: ${e.total ?? 0}`);
      }
    }
  }
}

main().catch(console.error);