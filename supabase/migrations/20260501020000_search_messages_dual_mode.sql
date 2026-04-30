-- ============================================================
-- Sage Phase 2 (Block A): search_messages dual-mode
-- ============================================================
-- 改造原因：
--   原版 search_messages 只允许 service_role 调用，迫使桌面端 sage-api
--   sidecar 必须持有 SUPABASE_SERVICE_ROLE_KEY 才能召回记忆。
--   service role 是 god mode，分发到用户机器 = 任何用户能读所有用户数据。
--
-- 新版双模式（按调用上下文自适应）：
--   - 桌面端 sidecar：用「anon key + 用户 JWT」调用，auth.uid() 非 NULL，
--     函数强制按本人 uid 过滤；用户即使在 user_id_filter 里传别人 uid
--     也会被 COALESCE 覆盖掉，物理隔离。
--   - Railway sage-api：用「service role key」调用，auth.uid() 为 NULL，
--     函数按 user_id_filter 过滤（service role 已经在应用层手动校验过 uid）。
--
-- 双重保险：
--   1. SECURITY INVOKER + RLS：authenticated 调用时 RLS 自动追加 user_id = auth.uid()
--   2. 函数内显式 WHERE：COALESCE(auth.uid(), user_id_filter) 强制按 effective uid 过滤
-- ============================================================

DROP FUNCTION IF EXISTS public.search_messages(TEXT, UUID, INTEGER, INTEGER);

CREATE OR REPLACE FUNCTION public.search_messages(
  q TEXT,
  user_id_filter UUID DEFAULT NULL,
  limit_n INTEGER DEFAULT 20,
  days_back INTEGER DEFAULT NULL
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
BEGIN
  IF q IS NULL OR LENGTH(TRIM(q)) = 0 THEN
    RETURN;
  END IF;

  effective_user_id := COALESCE(auth.uid(), user_id_filter);

  IF effective_user_id IS NULL THEN
    RETURN;
  END IF;

  IF limit_n IS NULL OR limit_n < 1 THEN
    limit_n := 20;
  ELSIF limit_n > 100 THEN
    limit_n := 100;
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
  ORDER BY rank DESC, m.created_at DESC
  LIMIT limit_n;
END;
$$;

COMMENT ON FUNCTION public.search_messages IS
  'Phase 2 Block A: 双模式召回。authenticated 调用走 auth.uid()（RLS + 显式 WHERE 双重隔离）；'
  'service_role 调用走 user_id_filter 参数。pgroonga 全文搜，按 score + created_at 排序。';

REVOKE EXECUTE ON FUNCTION public.search_messages(TEXT, UUID, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_messages(TEXT, UUID, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_messages(TEXT, UUID, INTEGER, INTEGER) TO service_role;
