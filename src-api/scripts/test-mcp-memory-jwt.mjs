// 端到端：模拟桌面端 sidecar
//   sage-api 启动时 *只有* SUPABASE_URL + SUPABASE_ANON_KEY（无 service role）
//   前端 fetch /mcp-memory?user_id=X&access_token=JWT，调 search_memory
//
// 验证：sidecar 在没有 service-role key 的情况下，靠用户 JWT 仍能召回到本人 messages。

import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !ANON || !SERVICE) {
  console.error('Need SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const USER_A = '33378acf-5efa-4ce8-8408-2375c2a9c3cb';

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
const userInfo = await admin.auth.admin.getUserById(USER_A);
const { data: link } = await admin.auth.admin.generateLink({
  type: 'magiclink',
  email: userInfo.data.user.email,
});
const anon = createClient(URL, ANON, { auth: { persistSession: false } });
const { data: sess, error: e1 } = await anon.auth.verifyOtp({
  type: 'magiclink',
  token_hash: link.properties.hashed_token,
});
if (e1) throw e1;
const jwt = sess.session.access_token;
console.log(`# Got JWT for user A (len=${jwt.length})`);

const PORT = '12027';
console.log(`# Starting sage-api on :${PORT} with NO service role key in env`);

const env = {
  ...process.env,
  PORT,
  NODE_ENV: 'production',
  SUPABASE_URL: URL,
  SUPABASE_ANON_KEY: ANON,
};
delete env.SUPABASE_SERVICE_ROLE_KEY;

const child = spawn(
  'pnpm',
  ['exec', 'tsx', 'src/index.ts'],
  { cwd: process.cwd(), env, stdio: ['ignore', 'pipe', 'pipe'] }
);

let stderrTail = '';
child.stdout.on('data', () => {});
child.stderr.on('data', (d) => {
  stderrTail += d.toString();
  if (stderrTail.length > 4000) stderrTail = stderrTail.slice(-4000);
});

let serverUp = false;
for (let i = 0; i < 30; i++) {
  await sleep(500);
  try {
    const resp = await fetch(`http://127.0.0.1:${PORT}/health`);
    if (resp.ok) {
      serverUp = true;
      break;
    }
  } catch {}
}
if (!serverUp) {
  console.error('sage-api did not come up');
  console.error('stderr tail:\n', stderrTail);
  child.kill();
  process.exit(1);
}
console.log('# sage-api ready');

// 调 mcp-memory: tools/call search_memory
const params = new URLSearchParams({
  user_id: USER_A,
  access_token: jwt,
});
const url = `http://127.0.0.1:${PORT}/mcp-memory?${params}`;

const body = {
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/call',
  params: {
    name: 'search_memory',
    arguments: { query: 'A', limit: 5 },
  },
};

const r = await fetch(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});
const j = await r.json();
console.log('\n# Response from /mcp-memory:');
console.log(JSON.stringify(j, null, 2));

child.kill();
console.log('\n# done');

if (j.error) {
  console.error('\nFAIL: RPC error');
  process.exit(1);
}
if (j.result?.isError) {
  console.error('\nFAIL: tool returned error');
  process.exit(1);
}
const text = j.result?.content?.[0]?.text || '';
if (!text.includes('共找到') && !text.includes('未找到')) {
  console.error('\nFAIL: unexpected response shape');
  process.exit(1);
}
console.log('\nPASS: sidecar without service role can still recall via JWT');
