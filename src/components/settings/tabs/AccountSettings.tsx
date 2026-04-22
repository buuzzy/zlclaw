import { useRef, useState } from 'react';
import { useLanguage } from '@/shared/providers/language-provider';
import { useDisplayIdentity, useProfile } from '@/shared/sync';
import { Camera, User } from 'lucide-react';
import { AvatarImage } from '@/components/layout/avatar-image';

import type { SettingsTabProps } from '../types';

/**
 * AccountSettings
 *
 * 用户必须已登录（AuthGuard 保证）。
 * 昵称和头像的真实数据源是云端 `public.profiles`，通过 ProfileProvider 统一管理。
 * 修改后 upsert 到云端，多设备下次登录自动同步。
 *
 * 注：`settings.profile` 仍在本地 SQLite 中作为遗留字段，不再使用。
 */
export function AccountSettings(_: SettingsTabProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { t } = useLanguage();
  const { update: updateProfile, isLoading } = useProfile();
  const { displayName, avatarUrl } = useDisplayIdentity();

  // 本地暂存昵称输入（按键态），失焦或回车时提交
  const [nicknameDraft, setNicknameDraft] = useState<string | null>(null);
  const nicknameValue = nicknameDraft ?? displayName;

  const handleAvatarClick = () => {
    fileInputRef.current?.click();
  };

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      updateProfile({ avatar_url: dataUrl }).catch(() => {
        // 错误已在 profile-sync 里 console.error
      });
    };
    reader.readAsDataURL(file);
  };

  const commitNickname = () => {
    if (nicknameDraft === null) return;
    const trimmed = nicknameDraft.trim();
    if (trimmed !== displayName) {
      updateProfile({ display_name: trimmed || null }).catch(() => {});
    }
    setNicknameDraft(null);
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="text-muted-foreground text-sm">
          {t.settings.manageProfile}
        </p>
      </div>

      {/* Avatar */}
      <div className="space-y-3">
        <label className="text-foreground text-sm font-medium">
          {t.settings.avatar}
        </label>
        <div className="flex items-center gap-4">
          <button
            onClick={handleAvatarClick}
            disabled={isLoading}
            className="bg-muted border-border hover:border-primary/50 group relative size-20 cursor-pointer overflow-hidden rounded-full border-2 border-dashed transition-colors disabled:cursor-not-allowed disabled:opacity-60"
          >
            {avatarUrl ? (
              <AvatarImage
                src={avatarUrl}
                alt="Avatar"
                className="size-full object-cover"
                iconClassName="text-muted-foreground absolute top-1/2 left-1/2 size-8 -translate-x-1/2 -translate-y-1/2"
              />
            ) : (
              <User className="text-muted-foreground absolute top-1/2 left-1/2 size-8 -translate-x-1/2 -translate-y-1/2" />
            )}
            <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
              <Camera className="size-5 text-white" />
            </div>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleAvatarChange}
            className="hidden"
          />
          <div className="space-y-1">
            <p className="text-muted-foreground text-sm">
              {t.settings.clickToUpload}
            </p>
            <p className="text-muted-foreground/70 text-xs">
              {t.settings.avatarRecommendation}
            </p>
          </div>
        </div>
      </div>

      {/* Nickname */}
      <div className="flex flex-col gap-2">
        <label className="text-foreground block text-sm font-medium">
          {t.settings.nickname}
        </label>
        <input
          type="text"
          value={nicknameValue}
          onChange={(e) => setNicknameDraft(e.target.value)}
          onBlur={commitNickname}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              (e.target as HTMLInputElement).blur();
            }
          }}
          placeholder={t.settings.enterNickname}
          className="border-input bg-background text-foreground placeholder:text-muted-foreground focus:ring-ring block h-10 w-full max-w-sm rounded-lg border px-3 text-sm focus:border-transparent focus:ring-2 focus:outline-none"
        />
      </div>
    </div>
  );
}
