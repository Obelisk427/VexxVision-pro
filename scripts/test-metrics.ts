// scripts/test-metrics.ts
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

  // Use the report code + fightID from the encounterRankings test
  // NPX best run: code "8K3XnZmv9kGTNHtP", fightID 11
  const code = '8K3XnZmv9kGTNHtP';
  const fightID = 11;

  // First: let's see what fights exist in this report
  const fightsQuery = `query {
    reportData {
      report(code: "${code}") {
        title
        startTime
        endTime
        fights {
          id
          name
          encounterID
          difficulty
          kill
          startTime
          endTime
        }
      }
    }
  }`;

  const fRes = await fetch(WCL_GQL_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: fightsQuery }),
  });
  const fJson = await fRes.json();
  const report = fJson.data.reportData.report;
  console.log(`Report: ${report.title}`);
  console.log(`Fights in report:`);
  for (const f of report.fights) {
    console.log(`  Fight ${f.id}: ${f.name} (enc: ${f.encounterID}, diff: ${f.difficulty}, kill: ${f.kill}, start: ${f.startTime}, end: ${f.endTime})`);
  }

  // Find fight 11 specifically
  const fight = report.fights.find((f: any) => f.id === fightID);
  if (fight) {
    console.log(`\n🎯 Target fight ${fightID}:`);
    console.log(`  Name: ${fight.name}, Start: ${fight.startTime}, End: ${fight.endTime}`);
    console.log(`  Duration: ${fight.endTime - fight.startTime}ms`);
  }

  // Now try the metrics query both ways
  console.log('\n═══ Metrics with fightIDs filter ═══');
  const metricsQ1 = `query {
    reportData { report(code: "${code}") {
      interrupts: table(fightIDs: [${fightID}], startTime: 0, endTime: 99999999, dataType: Interrupts)
      damage: table(fightIDs: [${fightID}], startTime: 0, endTime: 99999999, dataType: DamageTaken)
      deaths: table(fightIDs: [${fightID}], startTime: 0, endTime: 99999999, dataType: Deaths)
    }}
  }`;

  const m1Res = await fetch(WCL_GQL_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: metricsQ1 }),
  });
  const m1 = await m1Res.json();
  if (m1.errors) {
    console.log('Errors:', JSON.stringify(m1.errors, null, 2));
  } else {
    const r = m1.data.reportData.report;
    console.log('Interrupts entries:', JSON.stringify(r.interrupts?.data?.entries?.slice(0, 3), null, 2));
    console.log('Damage entries:', JSON.stringify(r.damage?.data?.entries?.slice(0, 3), null, 2));
    console.log('Deaths entries:', JSON.stringify(r.deaths?.data?.entries?.slice(0, 3), null, 2));
  }

  // Try with fight's actual start/end times
  if (fight) {
    console.log('\n═══ Metrics with fight start/end times ═══');
    const metricsQ2 = `query {
      reportData { report(code: "${code}") {
        interrupts: table(fightIDs: [${fightID}], startTime: ${fight.startTime}, endTime: ${fight.endTime}, dataType: Interrupts)
        damage: table(fightIDs: [${fightID}], startTime: ${fight.startTime}, endTime: ${fight.endTime}, dataType: DamageTaken)
        deaths: table(fightIDs: [${fightID}], startTime: ${fight.startTime}, endTime: ${fight.endTime}, dataType: Deaths)
      }}
    }`;

    const m2Res = await fetch(WCL_GQL_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: metricsQ2 }),
    });
    const m2 = await m2Res.json();
    if (m2.errors) {
      console.log('Errors:', JSON.stringify(m2.errors, null, 2));
    } else {
      const r = m2.data.reportData.report;

      console.log('Interrupts entries:');
      for (const e of (r.interrupts?.data?.entries ?? [])) {
        if (normalize(e.name) === normalize('Soultactix')) {
          console.log(`  ✅ ${e.name}: ${e.total}`);
        }
      }
      console.log('  All:', r.interrupts?.data?.entries?.map((e: any) => `${e.name}: ${e.total}`));

      console.log('Damage entries:');
      console.log('  All:', r.damage?.data?.entries?.map((e: any) => `${e.name}: ${e.total}`));

      console.log('Deaths entries:');
      console.log('  All:', r.deaths?.data?.entries?.map((e: any) => `${e.name}: ${e.total}`));
    }
  }
}

main().catch(console.error);