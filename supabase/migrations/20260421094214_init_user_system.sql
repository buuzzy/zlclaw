-- ============================================================
-- Sage 用户系统初始化迁移
-- 架构：Local-first + 云端元数据
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. 用户档案表（扩展 Supabase Auth 的 auth.users）
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email       TEXT,
  display_name TEXT,
  avatar_url  TEXT,
  -- 应用级字段
  app_version TEXT,                     -- 最后使用的 App 版本
  platform    TEXT,                     -- 'macos' | 'windows' | 'linux'
  -- 时间戳
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.profiles IS '用户档案，扩展 auth.users，每个用户一条记录';

-- ────────────────────────────────────────────────────────────
-- 2. 会话元数据表（不存消息体，只存轻量索引）
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sessions (
  id            TEXT PRIMARY KEY,        -- 复用本地 sessionId (UUID)
  user_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title         TEXT,
  preview       TEXT,                    -- 最后一条消息前 120 字
  message_count INT  NOT NULL DEFAULT 0,
  has_artifacts BOOLEAN NOT NULL DEFAULT FALSE,
  -- 时间戳（与本地文件同步）
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.sessions IS '会话元数据，不含完整消息内容，用于列表展示和跨设备同步';

CREATE INDEX IF NOT EXISTS idx_sessions_user_id_updated
  ON public.sessions (user_id, updated_at DESC);

-- ────────────────────────────────────────────────────────────
-- 3. 用户设置云备份表（偏好配置、技能开关等，不含敏感 Key）
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_settings (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- 设置内容（JSON，不含敏感 API Key，只存偏好和开关）
  -- 示例结构：
  -- {
  --   "defaultModel": "MiniMax-M1",
  --   "defaultProvider": "minimax",
  --   "enabledSkills": ["行情数据查询", "财务数据查询"],
  --   "theme": "dark",
  --   "language": "zh-CN"
  -- }
  settings   JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.user_settings IS '用户设置备份，不含敏感 API Key，仅存偏好配置';

-- ────────────────────────────────────────────────────────────
-- 4. 报错日志表
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.error_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,  -- 允许匿名上报
  -- 错误分类
  error_type   TEXT NOT NULL,           -- 'api_error' | 'skill_error' | 'crash' | 'network_error'
  error_code   TEXT,                    -- 可选错误码
  message      TEXT NOT NULL,
  stack_trace  TEXT,
  -- 上下文信息
  context      JSONB,                   -- { skillName, sessionId, toolName, ... }
  -- 环境信息
  app_version  TEXT,
  platform     TEXT,                    -- 'macos' | 'windows' | 'linux'
  os_version   TEXT,
  -- 时间
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.error_logs IS '客户端报错日志，支持匿名上报，用于 debug 和监控';

CREATE INDEX IF NOT EXISTS idx_error_logs_user_id
  ON public.error_logs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_logs_type
  ON public.error_logs (error_type, created_at DESC);

-- ────────────────────────────────────────────────────────────
-- 5. 自动更新 updated_at 的触发器函数
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER trg_sessions_updated_at
  BEFORE UPDATE ON public.sessions
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER trg_user_settings_updated_at
  BEFORE UPDATE ON public.user_settings
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ────────────────────────────────────────────────────────────
-- 6. 新用户注册时自动创建 profiles 记录
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(
      NEW.raw_user_meta_data->>'full_name',
      NEW.raw_user_meta_data->>'name',
      split_part(NEW.email, '@', 1)
    ),
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ────────────────────────────────────────────────────────────
-- 7. Row Level Security (RLS) — 用户只能访问自己的数据
-- ────────────────────────────────────────────────────────────

-- profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles: 本人可读写"
  ON public.profiles FOR ALL
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- sessions
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sessions: 本人可读写"
  ON public.sessions FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- user_settings
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_settings: 本人可读写"
  ON public.user_settings FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- error_logs：只允许插入（任何已登录用户或匿名均可上报）
ALTER TABLE public.error_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "error_logs: 可插入"
  ON public.error_logs FOR INSERT
  WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

-- service_role 绕过 RLS，后台可全量读取 error_logs
