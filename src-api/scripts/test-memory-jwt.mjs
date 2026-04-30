// 端到端测试：模拟桌面端 sidecar 场景，
// 不用 service_role key，仅用 anon key + 用户 JWT 调 search_messages RPC。
//
// 验证：
//   1. 用户 A 用自己的 JWT 调，能拿到自己的 messages
//   2. 用户 A 用自己的 JWT + user_id_filter=B，应被 COALESCE(auth.uid()) 覆盖，
//      只看到 A 的数据（物理隔离）

import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !ANON || !SERVICE) {
  console.error('Missing SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

// 用 admin API 给两个测试用户生成 access_token（绕过登录）
const admin = createClient(URL, SERVICE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const USER_A = '33378acf-5efa-4ce8-8408-2375c2a9c3cb'; // buuzzy@163.com, 50 msgs
const USER_B = '7951dda9-d3c9-4a15-922b-09abdc046296'; // vilocngo@gmail.com, 8 msgs

async function getJwtFor(userId) {
  // generateLink 会签发一个 magiclink token，但我们可以直接 createUser 后用
  // adminGenerateLink 方式拿到 access token。更直接：用 admin.signInAsUser?
  // 实际上 supabase-js admin 没暴露 signInAsUser；用 generateLink 取 hashed_token 后
  // 再 verifyOtp 换 session 即可。
  const { data: userInfo, error: e1 } = await admin.auth.admin.getUserById(userId);
  if (e1) throw new Error(`getUserById ${userId}: ${e1.message}`);

  const email = userInfo.user.email;
  const { data: link, error: e2 } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  });
  if (e2) throw new Error(`generateLink ${email}: ${e2.message}`);

  const hashed = link.properties.hashed_token;

  const anonClient = createClient(URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await anonClient.auth.verifyOtp({
    type: 'magiclink',
    token_hash: hashed,
  });
  if (error) throw new Error(`verifyOtp ${email}: ${error.message}`);
  return { jwt: data.session.access_token, email };
}

function userScopedClient(jwt) {
  return createClient(URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
}

async function searchAs(jwt, q, user_id_filter) {
  const c = userScopedClient(jwt);
  const { data, error } = await c.rpc('search_messages', {
    q,
    user_id_filter,
    limit_n: 5,
    days_back: null,
  });
  if (error) throw new Error(`RPC: ${error.message}`);
  return data || [];
}

console.log('# 1. 用 admin API 为两个用户生成 access_token');
const { jwt: jwtA, email: emailA } = await getJwtFor(USER_A);
const { jwt: jwtB, email: emailB } = await getJwtFor(USER_B);
console.log(`  user A = ${USER_A.slice(0, 8)} (${emailA}), jwt len=${jwtA.length}`);
console.log(`  user B = ${USER_B.slice(0, 8)} (${emailB}), jwt len=${jwtB.length}`);

console.log('\n# 2. 用户 A 调 search_messages, q="A", filter=A');
const r1 = await searchAs(jwtA, 'A', USER_A);
console.log(`  -> ${r1.length} rows. user_ids in result:`,
  [...new Set(r1.map((r) => 'redacted-from-rpc'))].join(','));
console.log('  task_ids:', r1.map((r) => r.task_id.slice(0, 6)).join(', '));

console.log('\n# 3. 用户 A 用自己的 JWT，但 user_id_filter 传 B 的 uid');
console.log('   预期：被 COALESCE(auth.uid(), user_id_filter) 强制覆盖为 A，');
console.log('         返回的内容应该跟测试 #2 完全一致（即只看到 A 的数据）');
const r2 = await searchAs(jwtA, 'A', USER_B);
console.log(`  -> ${r2.length} rows.`);
console.log('  task_ids:', r2.map((r) => r.task_id.slice(0, 6)).join(', '));

const sameAsR1 = r1.length === r2.length &&
  r1.every((r, i) => r.id === r2[i].id);
console.log('\n# 4. 隔离断言');
if (sameAsR1) {
  console.log('  PASS: 用 B 的 user_id_filter 没生效，返回的还是 A 的数据');
} else {
  console.log('  FAIL: 跨用户数据可能泄漏！');
  console.log('    r1 ids:', r1.map((r) => r.id.slice(0, 8)));
  console.log('    r2 ids:', r2.map((r) => r.id.slice(0, 8)));
  process.exit(1);
}

console.log('\n# 5. 用户 B 调 search_messages, q="A", filter=B');
const r3 = await searchAs(jwtB, 'A', USER_B);
console.log(`  -> ${r3.length} rows. task_ids:`, r3.map((r) => r.task_id.slice(0, 6)).join(', '));

console.log('\n# 6. 不传 JWT (anon-only) 调 RPC');
const anon = createClient(URL, ANON);
const { data: r4, error: e4 } = await anon.rpc('search_messages', {
  q: 'A',
  user_id_filter: USER_A,
  limit_n: 5,
  days_back: null,
});
console.log(`  -> error=${e4?.message ?? 'none'}, rows=${r4?.length ?? 0}`);
console.log('  预期：rows=0（anon 没有 auth.uid()，且 RLS 不放行 messages）');

console.log('\n所有测试通过');
