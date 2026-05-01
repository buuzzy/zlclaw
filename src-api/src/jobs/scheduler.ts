/**
 * Phase 3 Background Job Scheduler
 *
 * 使用 node-cron 在 sage-api 进程内嵌定时任务。
 *
 * 当前注册的任务：
 *   · persona-distill: 每天凌晨 2 点北京时间 → 跑所有用户的 persona 蒸馏
 *
 * 启动条件（同时满足才注册）：
 *   1. process.env.SAGE_ENABLE_BACKGROUND_JOBS === 'true'
 *      → Railway / 受控服务器才打开；桌面端 sidecar 默认关闭
 *   2. process.env.SUPABASE_SERVICE_ROLE_KEY 已配置
 *      → 没有 service-role 拉不到跨用户数据
 *   3. process.env.MIMO_API_KEY 已配置
 *      → 无 LLM key 蒸馏跑不了
 *
 * 注：调度器只在 Railway 上运行。桌面端用户的对话也走 Railway sage-api
 * 时会被纳入；本地纯 sidecar 模式下用户数据本来就同步到云端，由 Railway 蒸馏。
 */

import cron from 'node-cron';

import { distillAllUsers } from './distill-persona.js';

let registered = false;

/**
 * 注册 Phase 3 后台任务。
 * 必须在 sage-api 启动后、accept request 前调用。
 * 多次调用是幂等的（防止重复注册）。
 */
export function registerBackgroundJobs(): void {
  if (registered) return;

  if (process.env.SAGE_ENABLE_BACKGROUND_JOBS !== 'true') {
    console.log(
      '[scheduler] background jobs disabled (SAGE_ENABLE_BACKGROUND_JOBS != true)'
    );
    return;
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.warn(
      '[scheduler] SAGE_ENABLE_BACKGROUND_JOBS=true but SUPABASE_SERVICE_ROLE_KEY missing — skipping registration'
    );
    return;
  }

  if (!process.env.MIMO_API_KEY) {
    console.warn(
      '[scheduler] SAGE_ENABLE_BACKGROUND_JOBS=true but MIMO_API_KEY missing — skipping registration'
    );
    return;
  }

  // 北京时间凌晨 2 点 = UTC 18:00（前一天）
  // node-cron 默认按 server timezone，在 Railway 通常是 UTC，所以写 0 18 * * *
  // 显式 timezone 'Asia/Shanghai' 让本地/Railway 行为一致
  cron.schedule(
    '0 2 * * *',
    async () => {
      const startedAt = new Date().toISOString();
      console.log(`[scheduler] persona-distill: started at ${startedAt}`);
      try {
        const summary = await distillAllUsers();
        console.log(
          `[scheduler] persona-distill: done in ${summary.total_duration_ms}ms ` +
            `(${summary.ran} ran / ${summary.skipped} skipped / ${summary.errors} errors of ${summary.total_users} users)`
        );
        if (summary.errors > 0) {
          for (const u of summary.per_user) {
            if (u.error) {
              console.error(
                `[scheduler] persona-distill: user ${u.user_id} failed: ${u.error}`
              );
            }
          }
        }
      } catch (e) {
        console.error(
          `[scheduler] persona-distill: top-level failure:`,
          e instanceof Error ? e.message : String(e)
        );
      }
    },
    { timezone: 'Asia/Shanghai' }
  );

  registered = true;
  console.log(
    '[scheduler] persona-distill cron registered: 0 2 * * * (Asia/Shanghai)'
  );
}
