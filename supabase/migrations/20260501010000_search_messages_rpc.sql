-- ============================================================
-- Sage Phase 2: search_messages RPC
-- 用 pgroonga 全文搜索召回用户的历史 messages
-- 由 sage-api 的 mcp-memory tool 调用
-- ============================================================

CREATE OR REPLACE FUNCTION public.search_messages(
  q TEXT,
  user_id_filter UUID,
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
BEGIN
  -- 参数校验：q 不能是纯空白
  IF q IS NULL OR LENGTH(TRIM(q)) = 0 THEN
    RETURN;
  END IF;

  -- 安全上限：limit_n 不超过 100
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
  WHERE m.user_id = user_id_filter
    AND m.content &@~ q
    AND m.deleted_at IS NULL
    AND (days_back IS NULL OR m.created_at >= NOW() - (days_back || ' days')::INTERVAL)
  ORDER BY rank DESC, m.created_at DESC
  LIMIT limit_n;
END;
$$;

COMMENT ON FUNCTION public.search_messages IS
  'Phase 2 召回 RPC：服务端 service_role 调用，按 user_id 过滤 + pgroonga 全文搜索。'
  '返回带 pgroonga_score 排序的 messages，days_back 可选限制时间范围（NULL = 全部）';

-- ============================================================
-- 权限：只允许 service_role 调用（client 用 anon/authenticated 调走 RLS 路径）
-- 默认所有 role 可执行 function，我们撤销 anon/authenticated，仅 service_role
-- ============================================================
REVOKE EXECUTE ON FUNCTION public.search_messages FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.search_messages FROM anon;
REVOKE EXECUTE ON FUNCTION public.search_messages FROM authenticated;
GRANT EXECUTE ON FUNCTION public.search_messages TO service_role;
