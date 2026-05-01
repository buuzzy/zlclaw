-- ============================================================
-- Sage Phase 4 (M4-L4-M9): user_behavior 行为日志层
-- ============================================================
-- 背景：
--   Phase 3 的 persona_memory.profile.implicit 由蒸馏 cron 从
--   messages 表直接读 content 推断。但 messages 在过去 N 天的体量
--   会随用户活跃度爆炸增长，每次蒸馏全量扫一遍 content + 工具调用
--   不经济，也容易被「单条噪声 message」干扰。
--
--   引入 user_behavior 中间层：每次 user 提问时记一条结构化轻量
--   事件（user_id / ts / task_id / query_hash / skill_used /
--   asset_mentions），蒸馏 cron 改为先查这个表做行为统计
--   （热门标的、典型场景），再把结论写回 persona_memory.profile.
--   implicit.behavior_summary。
--
--   设计目标：
--     · 90 天滚动窗口（cron 清理），保持表小
--     · 写入路径轻量：单 INSERT，可与 messages 双写并行（不阻塞）
--     · 用户级隔离：RLS 严格，user 只能看自己的行为
--     · 仅记录脱敏摘要：query_hash 用 sha256，preview 限 200 字
--
-- 详见 docs/memory/phase4-design.md
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. user_behavior 主表
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.user_behavior (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ts            TIMESTAMPTZ NOT NULL DEFAULT now(),
  task_id       UUID,
  query_hash    TEXT,
  query_preview TEXT,
  skill_used    TEXT,
  asset_mentions TEXT[]
);

COMMENT ON TABLE public.user_behavior IS
  'L4-light 行为日志：用户每次提问的结构化轻量事件，由蒸馏 cron 聚合后写入 persona_memory.profile.implicit.behavior_summary。90 天滚动清理。';

COMMENT ON COLUMN public.user_behavior.query_hash IS
  'sha256(query) 前 16 字节，用于去重和频率统计';
COMMENT ON COLUMN public.user_behavior.query_preview IS
  'query 前 200 字符明文，便于审计和蒸馏 prompt 引用';
COMMENT ON COLUMN public.user_behavior.skill_used IS
  '触发的 skill name（如 westock-quote / 行情数据查询），可空';
COMMENT ON COLUMN public.user_behavior.asset_mentions IS
  '提到的标的代码列表（如 ["sh600519","00700.HK"]），可空';

-- ────────────────────────────────────────────────────────────
-- 2. 索引
-- ────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS user_behavior_user_id_ts_idx
  ON public.user_behavior (user_id, ts DESC);

-- 单独 ts 索引用于 cleanup function
CREATE INDEX IF NOT EXISTS user_behavior_ts_idx
  ON public.user_behavior (ts);

-- ────────────────────────────────────────────────────────────
-- 3. RLS：用户只能读写自己的行为日志
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.user_behavior ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_behavior_self_select" ON public.user_behavior;
CREATE POLICY "user_behavior_self_select"
  ON public.user_behavior
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_behavior_self_insert" ON public.user_behavior;
CREATE POLICY "user_behavior_self_insert"
  ON public.user_behavior
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- 注意：service_role 自动 bypass RLS（Railway 蒸馏 cron 用），
-- 不需要单独给 service_role 加策略

-- ────────────────────────────────────────────────────────────
-- 4. 90 天清理函数（由 cron 调用）
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.cleanup_old_user_behavior()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM public.user_behavior
  WHERE ts < now() - INTERVAL '90 days';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

COMMENT ON FUNCTION public.cleanup_old_user_behavior() IS
  '清理 90 天前的 user_behavior 记录。由 Railway 蒸馏 cron 每日触发。';

REVOKE ALL ON FUNCTION public.cleanup_old_user_behavior() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_old_user_behavior() TO service_role;
