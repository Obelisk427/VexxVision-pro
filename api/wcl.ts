import type { VercelRequest, VercelResponse } from '@vercel/node';

const WCL_TOKEN_URL = 'https://www.warcraftlogs.com/oauth/token';
const WCL_GQL_URL = 'https://www.warcraftlogs.com/api/v2/client';

let cachedToken: { token: string; expires: number } | null = null;

async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expires - 60_000) {
    return cachedToken.token;
  }

  const clientId = process.env.WCL_CLIENT_ID;
  const clientSecret = process.env.WCL_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('WCL credentials not configured on server');
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const response = await fetch(WCL_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!response.ok) {
    throw new Error(`WCL token request failed: ${response.status}`);
  }

  const json = await response.json();
  cachedToken = {
    token: json.access_token,
    expires: Date.now() + (json.expires_in ?? 3600) * 1000,
  };

  return cachedToken.token;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { query, variables } = req.body;

    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: 'Missing GraphQL query' });
    }

    const token = await getToken();

    const gqlResponse = await fetch(WCL_GQL_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });

    const data = await gqlResponse.json();
    return res.status(200).json(data);
  } catch (error: any) {
    console.error('[WCL Proxy Error]', error);
    return res.status(500).json({ error: error.message ?? 'Internal server error' });
  }
}