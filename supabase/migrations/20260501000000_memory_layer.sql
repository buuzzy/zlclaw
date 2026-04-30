-- ============================================================
-- Sage Phase 1: 记忆层云端 Schema
-- 包含：messages / tasks / files / persona_memory / user_notes / sync_state
-- 全部 RLS 隔离 + pgroonga 中文全文搜索
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 0. 前置：确保 pgroonga 扩展可用（需先在 Dashboard 启用）
-- ────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgroonga') THEN
    RAISE EXCEPTION
      'pgroonga 扩展未启用。请先在 Supabase Dashboard → Database → Extensions 启用 pgroonga 后再 push 此 migration';
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────
-- 1. updated_at 自动维护函数（复用）
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

-- ────────────────────────────────────────────────────────────
-- 2. tasks 上云
-- 本地 id 为 TEXT 时间戳格式（如 20260430120000_abc），跨设备唯一，复用作为云端 PK
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tasks (
  id          TEXT PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  session_id  TEXT NOT NULL,
  task_index  INTEGER NOT NULL DEFAULT 1,
  prompt      TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'running',
  cost        NUMERIC,
  duration    INTEGER,
  favorite    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ
);

COMMENT ON TABLE public.tasks IS 'Phase 1: 任务（每个 task 是一次完整 Q&A），跨设备同步';

CREATE INDEX IF NOT EXISTS idx_tasks_user_session
  ON public.tasks (user_id, session_id, task_index);
CREATE INDEX IF NOT EXISTS idx_tasks_user_updated
  ON public.tasks (user_id, updated_at DESC);

CREATE TRIGGER trg_tasks_updated_at
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read their own tasks"
  ON public.tasks FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own tasks"
  ON public.tasks FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own tasks"
  ON public.tasks FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own tasks"
  ON public.tasks FOR DELETE
  USING (auth.uid() = user_id);

-- ────────────────────────────────────────────────────────────
-- 3. messages 上云（核心表）
-- id 为客户端生成的 UUID v7（TEXT 类型，兼容本地 SQLite）
-- 注：本地 SQLite UUID 也用 TEXT 存（无 native uuid 类型），云端用原生 uuid 列
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.messages (
  id            UUID PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  task_id       TEXT NOT NULL,
  type          TEXT NOT NULL,
  content       TEXT,
  tool_name     TEXT,
  tool_input    TEXT,
  tool_output   TEXT,
  tool_use_id   TEXT,
  tool_metadata TEXT,
  subtype       TEXT,
  error_message TEXT,
  attachments   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ
);

COMMENT ON TABLE public.messages IS 'Phase 1: 完整对话原文（永久保留），是数字分身记忆的真相之源';

CREATE INDEX IF NOT EXISTS idx_messages_user_task
  ON public.messages (user_id, task_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_user_updated
  ON public.messages (user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_content_pgroonga
  ON public.messages USING pgroonga (content);

CREATE TRIGGER trg_messages_updated_at
  BEFORE UPDATE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read their own messages"
  ON public.messages FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own messages"
  ON public.messages FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own messages"
  ON public.messages FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own messages"
  ON public.messages FOR DELETE
  USING (auth.uid() = user_id);

-- ────────────────────────────────────────────────────────────
-- 4. files 上云（id 为 UUID v7）
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.files (
  id          UUID PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  task_id     TEXT NOT NULL,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL,
  path        TEXT NOT NULL,
  preview     TEXT,
  thumbnail   TEXT,
  is_favorite BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ
);

COMMENT ON TABLE public.files IS 'Phase 1: 用户上传/产出的文件元数据（实际文件后续接入 Supabase Storage）';

CREATE INDEX IF NOT EXISTS idx_files_user_task
  ON public.files (user_id, task_id, created_at);
CREATE INDEX IF NOT EXISTS idx_files_user_updated
  ON public.files (user_id, updated_at DESC);

CREATE TRIGGER trg_files_updated_at
  BEFORE UPDATE ON public.files
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read their own files"
  ON public.files FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own files"
  ON public.files FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own files"
  ON public.files FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own files"
  ON public.files FOR DELETE
  USING (auth.uid() = user_id);

-- ────────────────────────────────────────────────────────────
-- 5. sessions 表扩展（已存在）：加 deleted_at 支持软删除流转
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- ────────────────────────────────────────────────────────────
-- 6. persona_memory：分身（cron 巩固产出）
-- 对应 UI 「设置 → 记忆 → 分身」section
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.persona_memory (
  user_id          UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  content_md       TEXT NOT NULL DEFAULT '',
  consolidated_at  TIMESTAMPTZ,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.persona_memory IS 'Phase 1: cron 蒸馏的"分身"画像，每用户单 row';

CREATE TRIGGER trg_persona_memory_updated_at
  BEFORE UPDATE ON public.persona_memory
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.persona_memory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read their own persona_memory"
  ON public.persona_memory FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own persona_memory"
  ON public.persona_memory FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own persona_memory"
  ON public.persona_memory FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own persona_memory"
  ON public.persona_memory FOR DELETE
  USING (auth.uid() = user_id);

-- ────────────────────────────────────────────────────────────
-- 7. user_notes：笔记（用户主动编辑）
-- 对应 UI 「设置 → 记忆 → 笔记」section
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_notes (
  user_id     UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  content_md  TEXT NOT NULL DEFAULT '',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.user_notes IS 'Phase 1: 用户主动编辑的笔记，每用户单 row';

CREATE TRIGGER trg_user_notes_updated_at
  BEFORE UPDATE ON public.user_notes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.user_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read their own user_notes"
  ON public.user_notes FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own user_notes"
  ON public.user_notes FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own user_notes"
  ON public.user_notes FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own user_notes"
  ON public.user_notes FOR DELETE
  USING (auth.uid() = user_id);

-- ────────────────────────────────────────────────────────────
-- 8. sync_state：增量同步游标（按 device_id × table 隔离）
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sync_state (
  user_id        UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  device_id      TEXT NOT NULL,
  table_name     TEXT NOT NULL,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT '1970-01-01T00:00:00Z',
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, device_id, table_name)
);

COMMENT ON TABLE public.sync_state IS 'Phase 1: 跨设备增量同步游标，按设备×表隔离';

CREATE TRIGGER trg_sync_state_updated_at
  BEFORE UPDATE ON public.sync_state
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.sync_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read their own sync_state"
  ON public.sync_state FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own sync_state"
  ON public.sync_state FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own sync_state"
  ON public.sync_state FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own sync_state"
  ON public.sync_state FOR DELETE
  USING (auth.uid() = user_id);
