// scripts/test-interrupts.ts
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
  const fightStart = 150861447;
  const fightEnd = 152408433;

  // Try both Interrupts and Casts with interrupt filter
  const query = `query {
    reportData { report(code: "${code}") {
      interrupts: table(fightIDs: [${fightID}], startTime: ${fightStart}, endTime: ${fightEnd}, dataType: Interrupts)
      casts: table(fightIDs: [${fightID}], startTime: ${fightStart}, endTime: ${fightEnd}, dataType: Casts, filterExpression: "type = 'interrupt'")
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

  console.log('═══ RAW Interrupts table (full JSON) ═══');
  console.log(JSON.stringify(r.interrupts, null, 2)?.slice(0, 3000));

  console.log('\n═══ RAW Casts (interrupt filter) table ═══');
  console.log(JSON.stringify(r.casts, null, 2)?.slice(0, 3000));
}

main().catch(console.error);