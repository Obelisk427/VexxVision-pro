// scripts/test-int2.ts
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

  const code = '8K3XnZmv9kGTNHtP';
  const fightID = 11;
  const fightStart = 150861447;
  const fightEnd = 152408433;

  const query = `query {
    reportData { report(code: "${code}") {
      interrupts: table(fightIDs: [${fightID}], startTime: ${fightStart}, endTime: ${fightEnd}, dataType: Interrupts)
    }}
  }`;

  const res = await fetch(WCL_GQL_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const json = await res.json();
  const tab = json.data.reportData.report.interrupts;

  // Print every key at every level
  for (const entry of tab.data.entries) {
    console.log(`\nTop-level entry keys: ${Object.keys(entry).join(', ')}`);
    console.log(`  name: ${entry.name}, total: ${entry.total}`);
    
    // Check ALL possible nested arrays
    for (const key of Object.keys(entry)) {
      const val = entry[key];
      if (Array.isArray(val) && val.length > 0) {
        console.log(`  Array field "${key}" has ${val.length} items:`);
        for (const sub of val) {
          console.log(`    keys: ${Object.keys(sub).join(', ')}`);
          console.log(`    name: ${sub.name}, total: ${sub.total}`);
          
          // One more level deep
          for (const subKey of Object.keys(sub)) {
            const subVal = sub[subKey];
            if (Array.isArray(subVal) && subVal.length > 0) {
              console.log(`      Array "${subKey}" has ${subVal.length} items:`);
              for (const deep of subVal.slice(0, 2)) {
                console.log(`        name: ${deep.name}, total: ${deep.total}`);
              }
            }
          }
        }
      }
    }
  }
}

main().catch(console.error);