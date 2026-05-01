-- ============================================================
-- Sage Phase 3: search_messages v3
-- ============================================================
-- 演进背景：
--   v1.2.x 的 search_messages(q, user_id_filter, limit_n, days_back) 只支持
--   关键词 + 用户 + 时间窗口（按天）。
--
--   Phase 3 决策 5：用户的真实查询场景包含三个维度：
--     · 关键词（"小红书"、"比亚迪"）
--     · 时间窗口（"5月10日当天"、"3月份"）
--     · 角色筛选（agent 当时怎么说 vs 用户当时问什么）
--
--   v3 新增两个参数：
--     · time_start TIMESTAMPTZ NULL ：精确开始时间（开区间右界）
--     · time_end TIMESTAMPTZ NULL   ：精确结束时间（含）
--     · role_filter TEXT NULL       ：'user' | 'assistant' | NULL（不筛）
--
-- 向后兼容：
--   保留 days_back 参数（NULL 不限）。time_start 和 time_end 可与 days_back 共存：
--   实际过滤 = WHERE 三个条件 AND 在一起，更严格。
--
-- 详见 docs/memory/phase3-design.md 决策 5
-- ============================================================

DROP FUNCTION IF EXISTS public.search_messages(TEXT, UUID, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS public.search_messages(TEXT, UUID, INTEGER, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ, TEXT);

CREATE OR REPLACE FUNCTION public.search_messages(
  q TEXT,
  user_id_filter UUID DEFAULT NULL,
  limit_n INTEGER DEFAULT 20,
  days_back INTEGER DEFAULT NULL,
  time_start TIMESTAMPTZ DEFAULT NULL,
  time_end TIMESTAMPTZ DEFAULT NULL,
  role_filter TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  task_id TEXT,
  type TEXT,
  content TEXT,
  created_at TIMESTAMPTZ,
  rank REAL
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
AS $$
DECLARE
  effective_user_id UUID;
  normalized_role TEXT;
BEGIN
  IF q IS NULL OR LENGTH(TRIM(q)) = 0 THEN
    RETURN;
  END IF;

  -- 双模式安全：authenticated 用 auth.uid()；service_role 用 user_id_filter
  effective_user_id := COALESCE(auth.uid(), user_id_filter);

  IF effective_user_id IS NULL THEN
    RETURN;
  END IF;

  IF limit_n IS NULL OR limit_n < 1 THEN
    limit_n := 20;
  ELSIF limit_n > 100 THEN
    limit_n := 100;
  END IF;

  -- role_filter 规范化：仅接受 'user' / 'assistant' / NULL
  normalized_role := lower(NULLIF(TRIM(role_filter), ''));
  IF normalized_role IS NOT NULL
     AND normalized_role NOT IN ('user', 'assistant') THEN
    normalized_role := NULL;  -- 非法值不报错，按"不筛"处理
  END IF;

  RETURN QUERY
  SELECT
    m.id,
    m.task_id,
    m.type,
    m.content,
    m.created_at,
    pgroonga_score(m.tableoid, m.ctid)::REAL AS rank
  FROM public.messages m
  WHERE m.user_id = effective_user_id
    AND m.content &@~ q
    AND m.deleted_at IS NULL
    AND (days_back IS NULL OR m.created_at >= NOW() - (days_back || ' days')::INTERVAL)
    AND (time_start IS NULL OR m.created_at >= time_start)
    AND (time_end IS NULL OR m.created_at <= time_end)
    AND (normalized_role IS NULL OR m.type = normalized_role)
  ORDER BY rank DESC, m.created_at DESC
  LIMIT limit_n;
END;
$$;

COMMENT ON FUNCTION public.search_messages IS
  'Phase 3 v3: 双模式召回（authenticated 走 auth.uid()，service_role 走 user_id_filter）；'
  '支持关键词 + 时间窗口（days_back 或 time_start/time_end）+ 角色筛选（user/assistant/all）。';

REVOKE EXECUTE ON FUNCTION public.search_messages(TEXT, UUID, INTEGER, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_messages(TEXT, UUID, INTEGER, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_messages(TEXT, UUID, INTEGER, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ, TEXT) TO service_role;
