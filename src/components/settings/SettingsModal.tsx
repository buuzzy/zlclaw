import { useEffect, useState } from 'react';
import ImageLogo from '@/assets/logo.png';
import {
  getSettings,
  saveSettings,
  syncSettingsWithBackend,
  type Settings as SettingsType,
} from '@/shared/db/settings';
import {
  getAppDataDir,
  getDisplayPath,
  getMcpConfigPath,
  getSkillsDir,
} from '@/shared/lib/paths';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import { useUpdate } from '@/shared/providers/update-provider';

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

import { categoryIcons } from './constants';
import { AboutSettings } from './tabs/AboutSettings';
import { AccountSettings } from './tabs/AccountSettings';
import { ConnectorSettings } from './tabs/ConnectorSettings';
import { CronSettings } from './tabs/CronSettings';
import { DataSettings } from './tabs/DataSettings';
import { GeneralSettings } from './tabs/GeneralSettings';
import { MCPSettings } from './tabs/MCPSettings';
import { ModelSettings } from './tabs/ModelSettings';
import { PersonaSettings } from './tabs/PersonaSettings';
import { SkillsSettings } from './tabs/SkillsSettings';
import { WorkplaceSettings } from './tabs/WorkplaceSettings';
import type { SettingsCategory } from './types';

interface SettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialCategory?: SettingsCategory;
}

export function SettingsModal({
  open,
  onOpenChange,
  initialCategory,
}: SettingsModalProps) {
  const [settings, setSettings] = useState<SettingsType>(getSettings);
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>(
    initialCategory || 'account'
  );

  // Update active category when initialCategory changes
  useEffect(() => {
    if (initialCategory && open) {
      setActiveCategory(initialCategory);
    }
  }, [initialCategory, open]);
  const [defaultPaths, setDefaultPaths] = useState({
    workDir: '',
    mcpConfigPath: '',
    skillsPath: '',
  });
  const { t } = useLanguage();

  // 更新提示：在侧栏"关于" tab 项上显示红点，用户点到该 tab 时消失
  const update = useUpdate();
  const showAboutDot =
    update.status === 'available' &&
    update.latestVersion !== null &&
    update.latestVersion !== update.dismissedVersion &&
    update.latestVersion !== update.aboutSeenVersion;

  // 切到关于 tab → 通知 provider 更新 aboutSeenVersion（sidebar 外层红点也消失）
  useEffect(() => {
    if (activeCategory === 'about' && showAboutDot) {
      update.markAboutSeen();
    }
  }, [activeCategory, showAboutDot, update]);

  // Category list
  const categories: SettingsCategory[] = [
    'account',
    'general',
    'workplace',
    'model',
    'mcp',
    'skills',
    'connector',
    'cron',
    'persona',
    'data',
    'about',
  ];

  const getCategoryLabel = (id: SettingsCategory): string => {
    return t.settings[id];
  };

  // Load default paths on mount
  useEffect(() => {
    async function loadDefaultPaths() {
      const [workDir, mcpConfigPath, skillsPath] = await Promise.all([
        getAppDataDir().then(getDisplayPath),
        getMcpConfigPath().then(getDisplayPath),
        getSkillsDir().then(getDisplayPath),
      ]);
      setDefaultPaths({ workDir, mcpConfigPath, skillsPath });
    }
    loadDefaultPaths();
  }, []);

  // Load settings on mount
  useEffect(() => {
    if (open) {
      setSettings(getSettings());
    }
  }, [open]);

  // Save settings when changed
  const handleSettingsChange = (newSettings: SettingsType) => {
    setSettings(newSettings);
    saveSettings(newSettings);
    // Sync model configuration with backend
    syncSettingsWithBackend().catch((error) => {
      console.error('[Settings] Failed to sync with backend:', error);
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[600px] max-w-4xl gap-0 overflow-hidden p-0">
        <DialogTitle className="sr-only">{t.settings.title}</DialogTitle>

        <div className="flex h-full min-h-0">
          {/* Left Navigation */}
          <div className="border-border bg-muted/30 flex w-56 flex-col border-r">
            {/* Logo Header */}
            <div className="border-border flex items-center gap-2.5 border-b px-4 py-4">
              <img src={ImageLogo} alt="Sage" className="size-7" />
              <span className="text-foreground text-base font-semibold">
                Sage
              </span>
            </div>

            {/* Navigation Items */}
            <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
              {categories.map((id) => {
                const Icon = categoryIcons[id];
                const showDot = id === 'about' && showAboutDot;
                return (
                  <button
                    key={id}
                    onClick={() => setActiveCategory(id)}
                    className={cn(
                      'flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors duration-200 focus:outline-none focus-visible:outline-none',
                      activeCategory === id
                        ? 'bg-accent text-accent-foreground font-medium'
                        : 'text-foreground/70 hover:bg-accent/50 hover:text-foreground'
                    )}
                  >
                    <Icon className="size-4" />
                    <span className="flex-1 text-left">
                      {getCategoryLabel(id)}
                    </span>
                    {showDot && (
                      <span
                        aria-label="new update available"
                        className="size-1.5 shrink-0 rounded-full bg-red-500"
                      />
                    )}
                  </button>
                );
              })}
            </nav>
          </div>

          {/* Right Content */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {/* Header */}
            <div className="border-border flex shrink-0 items-center justify-between border-b px-6 py-4">
              <h2 className="text-foreground text-lg font-semibold">
                {getCategoryLabel(activeCategory)}
              </h2>
            </div>

            {/* Content Area */}
            <div className="min-h-0 flex-1 overflow-y-auto p-6">
              {activeCategory === 'account' && (
                <AccountSettings
                  settings={settings}
                  onSettingsChange={handleSettingsChange}
                />
              )}

              {activeCategory === 'general' && (
                <GeneralSettings
                  settings={settings}
                  onSettingsChange={handleSettingsChange}
                />
              )}

              {activeCategory === 'workplace' && (
                <WorkplaceSettings
                  settings={settings}
                  onSettingsChange={handleSettingsChange}
                  defaultPaths={defaultPaths}
                />
              )}

              {activeCategory === 'model' && (
                <ModelSettings
                  settings={settings}
                  onSettingsChange={handleSettingsChange}
                />
              )}

              {activeCategory === 'mcp' && (
                <MCPSettings
                  settings={settings}
                  onSettingsChange={handleSettingsChange}
                />
              )}

              {activeCategory === 'skills' && (
                <SkillsSettings
                  settings={settings}
                  onSettingsChange={handleSettingsChange}
                />
              )}

              {activeCategory === 'connector' && <ConnectorSettings />}

              {activeCategory === 'cron' && <CronSettings />}

              {activeCategory === 'persona' && <PersonaSettings />}

              {activeCategory === 'data' && <DataSettings />}

              {activeCategory === 'about' && <AboutSettings />}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
