/**
 * Internal Distill Cron Endpoint
 *
 * 用于触发 persona_memory 蒸馏的内部 HTTP 端点。
 * 鉴权方式：
 *   · 读取 process.env.SAGE_INTERNAL_TOKEN
 *   · 调用方必须带 Authorization: Bearer <SAGE_INTERNAL_TOKEN>
 *   · 桌面端 sidecar（无 token）调用此端点会被拒绝——这是 Railway 上才该有的能力
 *
 * 调用模式：
 *   · POST /internal/distill-cron        → 跑所有用户
 *   · POST /internal/distill-cron?user_id=XXX  → 仅蒸馏单个用户
 *
 * 触发方：
 *   · Railway 内嵌 node-cron（每天凌晨 2 点北京时间）→ 见 src/jobs/scheduler.ts
 *   · GitHub Actions schedule（备用方案，写在 RELEASE_v1.3.0.md）
 *   · 手动 curl 触发用于测试
 */

import { Hono } from 'hono';

import { distillAllUsers, distillUser } from '@/jobs/distill-persona';

export const internalDistillRoutes = new Hono();

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function checkAuth(req: Request): string | null {
  const token = process.env.SAGE_INTERNAL_TOKEN;
  if (!token) {
    return 'SAGE_INTERNAL_TOKEN env var not configured on this host';
  }
  const authHeader = req.headers.get('authorization') ?? '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match || match[1] !== token) {
    return 'invalid or missing bearer token';
  }
  return null;
}

internalDistillRoutes.post('/distill-cron', async (c) => {
  const authErr = checkAuth(c.req.raw);
  if (authErr) {
    return c.json({ ok: false, error: authErr }, 401);
  }

  const userId = c.req.query('user_id');
  if (userId) {
    if (!UUID_PATTERN.test(userId)) {
      return c.json({ ok: false, error: 'invalid user_id (must be UUID)' }, 400);
    }
    try {
      const stats = await distillUser(userId);
      return c.json({ ok: true, mode: 'single_user', stats });
    } catch (e) {
      return c.json(
        {
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        },
        500
      );
    }
  }

  try {
    const summary = await distillAllUsers();
    return c.json({ ok: true, mode: 'all_users', summary });
  } catch (e) {
    return c.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      },
      500
    );
  }
});

internalDistillRoutes.get('/distill-cron', (c) => {
  return c.text(
    'POST to this endpoint with Authorization: Bearer <SAGE_INTERNAL_TOKEN> to trigger persona distillation. Add ?user_id=UUID to scope to a single user.',
    200
  );
});
