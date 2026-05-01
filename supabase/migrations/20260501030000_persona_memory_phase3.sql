-- ============================================================
-- Sage Phase 3: persona_memory v3 schema
-- ============================================================
-- 演进背景：
--   v1.2.0 的 persona_memory 是 { content_md TEXT, consolidated_at TIMESTAMPTZ }
--   自由 markdown 散文，由 LLM 自由读写，无结构约束。
--
--   Phase 3 转向「记忆即身份」本体论后，需要：
--     · 结构化 JSON profile，蒸馏 prompt 严格按 schema 填，UI 可分块渲染
--     · 显式字段（用户主动声明）vs 隐式字段（行为推断）的字段分层
--     · recent_threads 单独存放，预注入时按需取
--     · last_distilled_at 用于增量蒸馏
--
-- 演进策略：
--   · 不 DROP 旧表（保留向前兼容，老 client 仍能读 content_md）
--   · ADD 新列，旧列保留但不再写入
--   · v1.3.0 上线后旧 content_md 永远为空字符串，可在未来版本删除
--
-- 详见 docs/memory/phase3-design.md 决策 1 + 决策 6
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. 扩展 persona_memory 表，加 Phase 3 所需的新列
-- ────────────────────────────────────────────────────────────

-- profile JSONB：完整画像（显式 + 隐式分层）
-- 默认值给一个空骨架，避免 NULL 处理。
ALTER TABLE public.persona_memory
  ADD COLUMN IF NOT EXISTS profile JSONB NOT NULL DEFAULT jsonb_build_object(
    'explicit', jsonb_build_object(
      'hard_rules', '[]'::jsonb,
      'focus_universe', jsonb_build_object(
        'declared', '[]'::jsonb,
        'exclusions', '[]'::jsonb
      )
    ),
    'implicit', jsonb_build_object(
      'focus_universe', jsonb_build_object('active', '[]'::jsonb),
      'risk_tolerance', null,
      'capability_level', null,
      'preferences', jsonb_build_object(),
      'recent_views', '[]'::jsonb
    )
  );

-- recent_threads JSONB：最近 N 个 user 提问 + agent_stance 摘要
-- 由蒸馏 cron 顺手产出，预注入时按 token 预算截断
ALTER TABLE public.persona_memory
  ADD COLUMN IF NOT EXISTS recent_threads JSONB NOT NULL DEFAULT '[]'::jsonb;

-- last_distilled_at：蒸馏游标，增量蒸馏只看此时间之后的 messages
ALTER TABLE public.persona_memory
  ADD COLUMN IF NOT EXISTS last_distilled_at TIMESTAMPTZ;

-- 旧列保留但加注释提示废弃
COMMENT ON COLUMN public.persona_memory.content_md IS
  'DEPRECATED in Phase 3 (v1.3.0+). Use profile JSONB instead. Kept for backward compat.';
COMMENT ON COLUMN public.persona_memory.consolidated_at IS
  'DEPRECATED in Phase 3 (v1.3.0+). Use last_distilled_at instead.';

COMMENT ON COLUMN public.persona_memory.profile IS
  'Phase 3: 结构化用户画像。explicit = 用户主动声明（hard_rules / focus_universe.declared / focus_universe.exclusions）；implicit = 蒸馏推断（focus_universe.active / risk_tolerance / capability_level / preferences / recent_views）';
COMMENT ON COLUMN public.persona_memory.recent_threads IS
  'Phase 3: 最近 N 个 user 提问 + agent_stance 一句话摘要，用于 system prompt 预注入';
COMMENT ON COLUMN public.persona_memory.last_distilled_at IS
  'Phase 3: 上次蒸馏完成时间，蒸馏 cron 用作增量游标';

-- ────────────────────────────────────────────────────────────
-- 2. 索引：按 last_distilled_at 排序找出该跑蒸馏的用户
-- ────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_persona_memory_distilled_at
  ON public.persona_memory (last_distilled_at NULLS FIRST);

-- ────────────────────────────────────────────────────────────
-- 3. RLS 不变（沿用 v1.2.0 已建的 4 条策略，profile/recent_threads/last_distilled_at
--    自动受同样的 user_id = auth.uid() 隔离）
-- ────────────────────────────────────────────────────────────

-- ────────────────────────────────────────────────────────────
-- 4. service_role 写入授权（蒸馏 cron 用）
--    现有 RLS 策略只允许 authenticated 用户操作自己的 row，
--    service_role 默认绕过 RLS 已经能写。这里显式 GRANT 确保 ALL 权限。
-- ────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.persona_memory TO service_role;

-- ────────────────────────────────────────────────────────────
-- 5. 兼容性：让 service_role 能在 INSERT 时带上 user_id 但不踩 RLS
--    （service_role 默认 BYPASSRLS，这条只是 belt-and-suspenders）
-- ────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'persona_memory'
      AND policyname = 'Service role full access'
  ) THEN
    EXECUTE 'CREATE POLICY "Service role full access" ON public.persona_memory FOR ALL TO service_role USING (true) WITH CHECK (true)';
  END IF;
END $$;
