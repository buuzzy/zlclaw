/**
 * Persona Settings - 用户画像查看与编辑
 *
 * Phase 3 引入。展示从云端 persona_memory 蒸馏出的用户画像：
 *   · 显式字段（用户主动声明）：硬规则 / 主动关注 / 主动排除 — 用户可删除
 *   · 隐式字段（系统行为推断）：风险偏好 / 能力水平 / 近期观点 — 只读
 *
 * 设计原则（决策 6 + 哲学）：
 *   · 画像由 AI 每天蒸馏自动更新，UI 不提供「添加规则」入口
 *     （用户在对话中说一次「以后不要 X」，蒸馏自然写入；这是「记忆即身份」的
 *     自然涌现路径，避免用户把 sage 当配置面板）
 *   · 删除显式字段是 UI 唯一的写入路径（用户可主动撤销自己说过的话）
 */

import { useCallback, useEffect, useState } from 'react';
import { useLanguage } from '@/shared/providers/language-provider';
import { supabase } from '@/shared/lib/supabase';
import { getCurrentBoundUid } from '@/shared/db/database';
import {
  EMPTY_PROFILE,
  type FocusUniverseDeclared,
  type FocusUniverseExclusion,
  type HardRule,
  type PersonaMemoryRow,
  type PersonaProfile,
} from '@/shared/types/persona-memory';
import {
  AlertTriangle,
  Loader2,
  RefreshCw,
  Sparkles,
  Trash2,
  UserCircle,
} from 'lucide-react';

// ─── Helpers ────────────────────────────────────────────────────────────────

const RISK_LABELS_ZH: Record<string, string> = {
  conservative: '保守',
  moderate: '稳健',
  aggressive: '进取',
  speculative: '激进',
};

const CAP_LABELS_ZH: Record<string, string> = {
  novice: '新手',
  intermediate: '中级',
  advanced: '进阶',
  professional: '专业',
};

const RISK_LABELS_EN: Record<string, string> = {
  conservative: 'Conservative',
  moderate: 'Moderate',
  aggressive: 'Aggressive',
  speculative: 'Speculative',
};

const CAP_LABELS_EN: Record<string, string> = {
  novice: 'Novice',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
  professional: 'Professional',
};

function formatTime(iso: string | null, locale: 'zh' | 'en'): string {
  if (!iso) return locale === 'zh' ? '尚未蒸馏' : 'Not yet distilled';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

// ─── Component ──────────────────────────────────────────────────────────────

export function PersonaSettings() {
  const { language } = useLanguage();
  const lang: 'zh' | 'en' = language === 'en-US' ? 'en' : 'zh';
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [row, setRow] = useState<PersonaMemoryRow | null>(null);
  const [busy, setBusy] = useState(false);

  const profile: PersonaProfile = row?.profile ?? EMPTY_PROFILE;

  const fetchPersona = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const uid = getCurrentBoundUid();
      if (!uid) {
        setError(
          lang === 'zh' ? '请先登录后查看画像' : 'Sign in to view your persona'
        );
        setRow(null);
        return;
      }
      const { data, error: dbErr } = await supabase
        .from('persona_memory')
        .select('*')
        .eq('user_id', uid)
        .maybeSingle();
      if (dbErr) {
        throw new Error(dbErr.message);
      }
      setRow((data as PersonaMemoryRow | null) ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [lang]);

  useEffect(() => {
    fetchPersona();
  }, [fetchPersona]);

  // ── 删除显式字段：read-modify-write JSONB ─────────────────────────────────
  async function persistProfile(next: PersonaProfile) {
    const uid = getCurrentBoundUid();
    if (!uid) {
      setError(lang === 'zh' ? '请先登录' : 'Not logged in');
      return;
    }
    setBusy(true);
    try {
      // upsert：如果 row 不存在（用户从未蒸馏过）也允许写入空 row + 删除标记
      const { error: dbErr } = await supabase
        .from('persona_memory')
        .upsert(
          {
            user_id: uid,
            profile: next,
            recent_threads: row?.recent_threads ?? [],
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' }
        );
      if (dbErr) throw new Error(dbErr.message);
      setRow((prev) =>
        prev
          ? { ...prev, profile: next, updated_at: new Date().toISOString() }
          : null
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function deleteHardRule(id: string) {
    const next: PersonaProfile = {
      ...profile,
      explicit: {
        ...profile.explicit,
        hard_rules: (profile.explicit?.hard_rules ?? []).filter(
          (r) => r.id !== id
        ),
      },
    };
    void persistProfile(next);
  }

  function deleteDeclared(idx: number) {
    const declared = profile.explicit?.focus_universe?.declared ?? [];
    const next: PersonaProfile = {
      ...profile,
      explicit: {
        ...profile.explicit,
        focus_universe: {
          ...profile.explicit.focus_universe,
          declared: declared.filter((_, i) => i !== idx),
          exclusions: profile.explicit.focus_universe?.exclusions ?? [],
        },
      },
    };
    void persistProfile(next);
  }

  function deleteExclusion(idx: number) {
    const exclusions = profile.explicit?.focus_universe?.exclusions ?? [];
    const next: PersonaProfile = {
      ...profile,
      explicit: {
        ...profile.explicit,
        focus_universe: {
          ...profile.explicit.focus_universe,
          declared: profile.explicit.focus_universe?.declared ?? [],
          exclusions: exclusions.filter((_, i) => i !== idx),
        },
      },
    };
    void persistProfile(next);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        {lang === 'zh' ? '加载中…' : 'Loading…'}
      </div>
    );
  }

  if (error && !row) {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <div className="flex-1">{error}</div>
      </div>
    );
  }

  const hardRules = profile.explicit?.hard_rules ?? [];
  const declared = profile.explicit?.focus_universe?.declared ?? [];
  const exclusions = profile.explicit?.focus_universe?.exclusions ?? [];
  const active = profile.implicit?.focus_universe?.active ?? [];
  const views = profile.implicit?.recent_views ?? [];
  const prefs = profile.implicit?.preferences ?? {};
  const riskLabels = lang === 'zh' ? RISK_LABELS_ZH : RISK_LABELS_EN;
  const capLabels = lang === 'zh' ? CAP_LABELS_ZH : CAP_LABELS_EN;

  const noExplicit =
    hardRules.length === 0 && declared.length === 0 && exclusions.length === 0;
  const noImplicit =
    active.length === 0 &&
    !profile.implicit?.risk_tolerance &&
    !profile.implicit?.capability_level &&
    Object.keys(prefs).length === 0 &&
    views.length === 0;

  return (
    <div className="space-y-6">
      {/* Header: distilled time + refresh */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {lang === 'zh' ? '上次更新：' : 'Last updated: '}
          {formatTime(row?.last_distilled_at ?? null, lang)}
        </div>
        <button
          onClick={() => void fetchPersona()}
          className="flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
          disabled={busy}
          title={lang === 'zh' ? '刷新' : 'Refresh'}
        >
          <RefreshCw className="size-3.5" />
          {lang === 'zh' ? '刷新' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <div className="flex-1">{error}</div>
        </div>
      )}

      {/* Explicit section */}
      <section>
        <div className="mb-2 flex items-center gap-2">
          <UserCircle className="size-4 text-foreground" />
          <h3 className="text-sm font-semibold">
            {lang === 'zh' ? '你的明确声明' : 'Your declared rules'}
          </h3>
        </div>
        <p className="mb-3 text-xs text-muted-foreground">
          {lang === 'zh'
            ? 'Sage 从对话中识别你立的规则、关注与排除。可在此撤销。'
            : 'Rules, focus, and exclusions identified from your conversations. You can revoke any item here.'}
        </p>

        {noExplicit ? (
          <div className="rounded-md border border-border bg-muted/30 px-3 py-3 text-xs text-muted-foreground">
            {lang === 'zh'
              ? '尚无明确声明。在对话中告诉 Sage「以后不要 X」、「我开始研究 Y 了」等表达，蒸馏后会出现在这里。'
              : 'No declarations yet. Tell Sage things like "Never recommend X" or "I focus on Y" — they will appear here after distillation.'}
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <div className="mb-1.5 text-xs font-medium text-muted-foreground">
                {lang === 'zh' ? '硬规则' : 'Hard rules'}
              </div>
              {hardRules.length > 0 ? (
                <ul className="space-y-1">
                  {hardRules.map((r: HardRule) => (
                    <li
                      key={r.id}
                      className="flex items-start gap-2 rounded-md border border-border bg-background px-3 py-2"
                    >
                      <span className="flex-1 text-sm">{r.content}</span>
                      <button
                        onClick={() => deleteHardRule(r.id)}
                        disabled={busy}
                        className="flex cursor-pointer items-center justify-center rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-50"
                        title={lang === 'zh' ? '删除' : 'Delete'}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="rounded-md border border-dashed border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                  {lang === 'zh'
                    ? '暂无硬规则'
                    : 'No hard rules yet'}
                </div>
              )}
            </div>

            <div>
              <div className="mb-1.5 text-xs font-medium text-muted-foreground">
                {lang === 'zh' ? '主动关注' : 'Focused on'}
              </div>
              {declared.length > 0 ? (
                <ul className="space-y-1">
                  {declared.map((d: FocusUniverseDeclared, idx) => (
                    <li
                      key={idx}
                      className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2"
                    >
                      <span className="flex-1 text-sm">
                        {d.name}
                        {d.code ? (
                          <span className="ml-1 text-muted-foreground">
                            ({d.code})
                          </span>
                        ) : null}
                      </span>
                      <button
                        onClick={() => deleteDeclared(idx)}
                        disabled={busy}
                        className="flex cursor-pointer items-center justify-center rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-50"
                        title={lang === 'zh' ? '删除' : 'Delete'}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="rounded-md border border-dashed border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                  {lang === 'zh'
                    ? '暂无主动关注的对象'
                    : 'No declared focus yet'}
                </div>
              )}
            </div>

            <div>
              <div className="mb-1.5 text-xs font-medium text-muted-foreground">
                {lang === 'zh' ? '主动排除' : 'Excluded from focus'}
              </div>
              {exclusions.length > 0 ? (
                <ul className="space-y-1">
                  {exclusions.map((e: FocusUniverseExclusion, idx) => (
                    <li
                      key={idx}
                      className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2"
                    >
                      <span className="flex-1 text-sm">{e.value}</span>
                      <button
                        onClick={() => deleteExclusion(idx)}
                        disabled={busy}
                        className="flex cursor-pointer items-center justify-center rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-50"
                        title={lang === 'zh' ? '删除' : 'Delete'}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="rounded-md border border-dashed border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                  {lang === 'zh'
                    ? '暂无主动排除的对象'
                    : 'No exclusions yet'}
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      {/* Implicit section */}
      <section>
        <div className="mb-2 flex items-center gap-2">
          <Sparkles className="size-4 text-foreground" />
          <h3 className="text-sm font-semibold">
            {lang === 'zh'
              ? 'Sage 对你的观察'
              : "Sage's observations of you"}
          </h3>
        </div>
        <p className="mb-3 text-xs text-muted-foreground">
          {lang === 'zh'
            ? '基于以往对话蒸馏的画像，由 AI 每天自动更新，仅供参考。'
            : 'Distilled from past conversations, refreshed daily by AI. Inferences only.'}
        </p>

        {noImplicit ? (
          <div className="rounded-md border border-border bg-muted/30 px-3 py-3 text-xs text-muted-foreground">
            {lang === 'zh'
              ? '画像还没建立。多和 Sage 聊一些金融问题，蒸馏会逐步识别你的偏好。'
              : 'Profile is still empty. Talk more with Sage so it can identify your preferences.'}
          </div>
        ) : (
          <div className="space-y-3 rounded-md border border-border bg-background p-4">
            {/* Risk + capability + preferences */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {profile.implicit?.risk_tolerance && (
                <div>
                  <div className="text-xs text-muted-foreground">
                    {lang === 'zh' ? '风险偏好' : 'Risk tolerance'}
                  </div>
                  <div className="text-sm">
                    {riskLabels[profile.implicit.risk_tolerance] ??
                      profile.implicit.risk_tolerance}
                  </div>
                </div>
              )}
              {profile.implicit?.capability_level && (
                <div>
                  <div className="text-xs text-muted-foreground">
                    {lang === 'zh' ? '能力水平' : 'Capability level'}
                  </div>
                  <div className="text-sm">
                    {capLabels[profile.implicit.capability_level] ??
                      profile.implicit.capability_level}
                  </div>
                </div>
              )}
              {prefs.language && (
                <div>
                  <div className="text-xs text-muted-foreground">
                    {lang === 'zh' ? '语言偏好' : 'Language preference'}
                  </div>
                  <div className="text-sm">{prefs.language}</div>
                </div>
              )}
              {prefs.explanation_style && (
                <div>
                  <div className="text-xs text-muted-foreground">
                    {lang === 'zh' ? '解释风格' : 'Explanation style'}
                  </div>
                  <div className="text-sm">{prefs.explanation_style}</div>
                </div>
              )}
              {prefs.response_length && (
                <div>
                  <div className="text-xs text-muted-foreground">
                    {lang === 'zh' ? '回应详略' : 'Response length'}
                  </div>
                  <div className="text-sm">{prefs.response_length}</div>
                </div>
              )}
            </div>

            {/* Active focus */}
            {active.length > 0 && (
              <div>
                <div className="mb-1.5 text-xs text-muted-foreground">
                  {lang === 'zh'
                    ? '近期常聊到的对象'
                    : 'Frequently discussed'}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {active.slice(0, 12).map((a, idx) => (
                    <span
                      key={idx}
                      className="rounded-md border border-border bg-muted/50 px-2 py-0.5 text-xs"
                    >
                      {a.name}
                      {a.code ? (
                        <span className="ml-1 text-muted-foreground">
                          ({a.code})
                        </span>
                      ) : null}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Recent views */}
            {views.length > 0 && (
              <div>
                <div className="mb-1.5 text-xs text-muted-foreground">
                  {lang === 'zh'
                    ? '近期观点（用户当前持有的看法，可能会变）'
                    : 'Recent views (current opinions, may evolve)'}
                </div>
                <ul className="space-y-1 text-xs">
                  {views.slice(0, 6).map((v, idx) => (
                    <li key={idx}>
                      <span className="text-muted-foreground">
                        {lang === 'zh' ? '关于' : 'On'} {v.topic}：
                      </span>
                      {v.stance}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </section>

      <p className="text-xs text-muted-foreground">
        {lang === 'zh'
          ? '画像由 AI 蒸馏自动产生，每天更新一次。明确声明可在此撤销；观察类信息会跟随你的对话演化。'
          : 'Profile is auto-distilled and refreshed daily. Declared rules can be revoked here; observation fields evolve with your conversations.'}
      </p>
    </div>
  );
}
