/**
 * Connector / Channel Settings
 *
 * Manages external messaging channel integrations (WeChat, Feishu).
 * WeChat: WeClaw QR code scanning flow
 * Feishu: Form-based configuration (App ID, App Secret, etc.)
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE_URL } from '@/config';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  MessageCircle,
  RefreshCw,
  X,
} from 'lucide-react';
import QRCode from 'qrcode';

type WeChatStatus =
  | 'idle'
  | 'starting'
  | 'installing'
  | 'waiting_scan'
  | 'connected'
  | 'bound_other'
  | 'error';

interface WeChatStatusResponse {
  status: WeChatStatus;
  qrUrl: string | null;
  qrExpireAt: number | null;
  errorMessage: string | null;
  installed: boolean;
  hasConfig: boolean;
  pid: number | null;
  boundAgent: string | null;
  boundToSage: boolean;
  running: boolean;
}

interface StartResponse {
  ok: boolean;
  status?: WeChatStatus;
  qrUrl?: string;
  qrExpireAt?: number;
  error?: string;
  message?: string;
  installUrl?: string;
}

export function ConnectorSettings() {
  const { t } = useLanguage();
  const [wechatStatus, setWechatStatus] = useState<WeChatStatus>('idle');
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [qrExpireAt, setQrExpireAt] = useState<number | null>(null);
  const [countdown, setCountdown] = useState<number>(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isInstalled, setIsInstalled] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [bindLoading, setBindLoading] = useState(false);
  const [showQrPanel, setShowQrPanel] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [boundAgent, setBoundAgent] = useState<string | null>(null);
  const [, setBoundToSage] = useState(false);
  const [, setIsRunning] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/channels/wechat/status`);
      if (!res.ok) return;
      const data: WeChatStatusResponse = await res.json();
      setWechatStatus(data.status);
      setQrUrl(data.qrUrl);
      setQrExpireAt(data.qrExpireAt);
      setErrorMessage(data.errorMessage);
      setIsInstalled(data.installed);
      setBoundAgent(data.boundAgent);
      setBoundToSage(data.boundToSage);
      setIsRunning(data.running);

      if (data.status === 'connected') {
        stopPolling();
        setShowQrPanel(false);
      }
      if (data.status === 'bound_other') {
        stopPolling();
        setShowQrPanel(false);
      }
    } catch {
      // backend not reachable
    }
  }, []);

  const startPolling = useCallback(() => {
    stopPolling();
    pollRef.current = setInterval(fetchStatus, 2000);
  }, [fetchStatus]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    return () => {
      stopPolling();
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [fetchStatus, stopPolling]);

  useEffect(() => {
    if (!qrUrl) {
      setQrDataUrl(null);
      return;
    }
    QRCode.toDataURL(qrUrl, {
      width: 280,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' },
    })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(null));
  }, [qrUrl]);

  useEffect(() => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    if (!qrExpireAt) {
      setCountdown(0);
      return;
    }
    const update = () => {
      const remaining = Math.max(
        0,
        Math.floor((qrExpireAt - Date.now()) / 1000)
      );
      setCountdown(remaining);
      if (remaining <= 0 && countdownRef.current) {
        clearInterval(countdownRef.current);
      }
    };
    update();
    countdownRef.current = setInterval(update, 1000);
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [qrExpireAt]);

  const handleStartWeChat = async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const res = await fetch(`${API_BASE_URL}/channels/wechat/start`, {
        method: 'POST',
      });
      const data: StartResponse = await res.json();

      if (!res.ok || !data.ok) {
        if (data.error === 'weclaw_not_installed') {
          setIsInstalled(false);
          setErrorMessage(data.message || t.settings.wechatNotInstalled);
        } else {
          setErrorMessage(data.message || t.settings.wechatStartFailed);
        }
        setWechatStatus('error');
        return;
      }

      const status = data.status || 'starting';
      setWechatStatus(status);

      if (status === 'connected') {
        // Existing session reused — no QR needed
        return;
      }

      if (data.qrUrl) {
        setQrUrl(data.qrUrl);
        setQrExpireAt(data.qrExpireAt || null);
      }

      setShowQrPanel(true);
      startPolling();
    } catch (err) {
      setErrorMessage((err as Error).message);
      setWechatStatus('error');
    } finally {
      setLoading(false);
    }
  };

  const handleStopWeChat = async () => {
    try {
      await fetch(`${API_BASE_URL}/channels/wechat/stop`, { method: 'POST' });
    } catch {
      // ignore
    }
    stopPolling();
    setWechatStatus('idle');
    setQrUrl(null);
    setQrExpireAt(null);
    setShowQrPanel(false);
  };

  const handleBindToSage = async () => {
    setBindLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/channels/wechat/bind`, {
        method: 'POST',
      });
      if (res.ok) {
        setBoundToSage(true);
        setBoundAgent('sage');
        await fetchStatus();
      }
    } catch {
      // ignore
    } finally {
      setBindLoading(false);
    }
  };

  const handleRefreshQr = () => {
    handleStopWeChat().then(handleStartWeChat);
  };

  const statusBadge = () => {
    switch (wechatStatus) {
      case 'connected':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-600 dark:text-green-400">
            <CheckCircle2 className="size-3" />
            {t.settings.wechatConnected}
          </span>
        );
      case 'bound_other':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-orange-500/10 px-2 py-0.5 text-xs font-medium text-orange-600 dark:text-orange-400">
            <AlertCircle className="size-3" />
            已绑定 {boundAgent || '其他 Agent'}
          </span>
        );
      case 'installing':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-2 py-0.5 text-xs font-medium text-blue-600 dark:text-blue-400">
            <Loader2 className="size-3 animate-spin" />
            正在安装...
          </span>
        );
      case 'waiting_scan':
      case 'starting':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
            <Loader2 className="size-3 animate-spin" />
            {t.settings.wechatConnecting}
          </span>
        );
      case 'error':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-600 dark:text-red-400">
            <AlertCircle className="size-3" />
            {t.settings.wechatStartFailed}
          </span>
        );
      default:
        return (
          <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
            {t.settings.wechatDisconnected}
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <h3 className="text-foreground text-base font-semibold">
          {t.settings.connector}
        </h3>
        <span className="rounded-md bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
          {t.settings.connectorBeta}
        </span>
      </div>
      <p className="text-muted-foreground text-sm">
        {t.settings.connectorDescription}
      </p>

      {/* WeChat Card */}
      <div className="border-border bg-background rounded-xl border">
        <div className="flex items-center justify-between p-5">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-green-500/10">
              <MessageCircle className="size-5 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-foreground text-sm font-medium">
                  {t.settings.wechatTitle}
                </span>
                <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                  {t.settings.wechatRecommended}
                </span>
              </div>
              <p className="text-muted-foreground mt-0.5 text-xs">
                {t.settings.wechatDescription}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {statusBadge()}
            {wechatStatus === 'connected' ? (
              <button
                onClick={handleStopWeChat}
                className="text-muted-foreground hover:text-foreground rounded-md border px-3 py-1.5 text-xs transition-colors"
              >
                {t.settings.wechatDisconnect}
              </button>
            ) : wechatStatus === 'bound_other' ? (
              <button
                onClick={handleBindToSage}
                disabled={bindLoading}
                className={cn(
                  'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                  'bg-orange-600 text-white hover:bg-orange-700',
                  bindLoading && 'cursor-not-allowed opacity-50'
                )}
              >
                {bindLoading ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  '切换到涨乐金融龙虾'
                )}
              </button>
            ) : (
              <button
                onClick={handleStartWeChat}
                disabled={loading}
                className={cn(
                  'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                  'bg-primary text-primary-foreground hover:bg-primary/90',
                  loading && 'cursor-not-allowed opacity-50'
                )}
              >
                {loading ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  t.settings.wechatConfigure
                )}
              </button>
            )}
          </div>
        </div>

        {/* Bound to other agent info */}
        {wechatStatus === 'bound_other' && (
          <div className="border-border border-t px-5 py-4">
            <div className="flex items-start gap-3 rounded-lg bg-orange-500/5 p-3">
              <AlertCircle className="mt-0.5 size-4 shrink-0 text-orange-500" />
              <div className="space-y-1">
                <p className="text-foreground text-sm font-medium">
                  WeClaw 当前绑定到{' '}
                  <span className="text-orange-600 dark:text-orange-400">
                    {boundAgent || '其他 Agent'}
                  </span>
                </p>
                <p className="text-muted-foreground text-xs">
                  微信消息正在发送到其他 Agent。点击「切换到涨乐金融龙虾」将修改
                  WeClaw 配置并重启服务，使微信消息转发到涨乐金融龙虾。
                </p>
              </div>
            </div>
          </div>
        )}

        {/* QR Code Panel */}
        {showQrPanel && (
          <div className="border-border border-t px-5 py-6">
            <div className="flex flex-col items-center">
              {/* Not Installed Warning */}
              {isInstalled === false && (
                <div className="mb-4 flex flex-col items-center gap-2 text-center">
                  <AlertCircle className="size-8 text-amber-500" />
                  <p className="text-foreground text-sm font-medium">
                    {t.settings.wechatNotInstalled}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {t.settings.wechatNotInstalledHint}
                  </p>
                  <a
                    href="https://github.com/fastclaw-ai/weclaw"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary mt-1 inline-flex items-center gap-1 text-xs hover:underline"
                  >
                    {t.settings.wechatInstallGuide}
                    <ExternalLink className="size-3" />
                  </a>
                  <button
                    onClick={() => setShowQrPanel(false)}
                    className="text-muted-foreground hover:text-foreground mt-2 text-xs"
                  >
                    关闭
                  </button>
                </div>
              )}

              {/* Error State */}
              {wechatStatus === 'error' && isInstalled !== false && (
                <div className="mb-4 flex flex-col items-center gap-2 text-center">
                  <AlertCircle className="size-8 text-red-500" />
                  <p className="text-foreground text-sm font-medium">
                    {t.settings.wechatStartFailed}
                  </p>
                  {errorMessage && (
                    <p className="text-muted-foreground max-w-xs text-xs">
                      {errorMessage}
                    </p>
                  )}
                  <button
                    onClick={handleRefreshQr}
                    className="text-primary mt-1 inline-flex items-center gap-1 text-xs hover:underline"
                  >
                    <RefreshCw className="size-3" />
                    重试
                  </button>
                </div>
              )}

              {/* Installing State */}
              {wechatStatus === 'installing' && (
                <div className="flex flex-col items-center gap-3 py-4">
                  <Loader2 className="text-primary size-8 animate-spin" />
                  <p className="text-foreground text-sm font-medium">
                    正在自动安装 WeClaw...
                  </p>
                  <p className="text-muted-foreground text-xs">
                    首次使用需下载微信网关组件，请稍候
                  </p>
                </div>
              )}

              {/* Connecting with existing session (no QR needed) */}
              {wechatStatus === 'starting' && !qrUrl && (
                <div className="flex flex-col items-center gap-3 py-4">
                  <Loader2 className="text-primary size-8 animate-spin" />
                  <p className="text-foreground text-sm font-medium">
                    正在使用已有会话连接...
                  </p>
                  <p className="text-muted-foreground text-xs">
                    检测到已登录的微信账号，正在恢复连接
                  </p>
                  <button
                    onClick={() => {
                      setShowQrPanel(false);
                      stopPolling();
                    }}
                    className="text-muted-foreground hover:text-foreground mt-2 inline-flex items-center gap-1 text-xs"
                  >
                    <X className="size-3" />
                    关闭
                  </button>
                </div>
              )}

              {/* QR Code (new login or re-auth required) */}
              {(wechatStatus === 'waiting_scan' ||
                (wechatStatus === 'starting' && qrUrl)) && (
                <>
                  <p className="text-foreground mb-4 text-sm">
                    {t.settings.wechatScanning}
                  </p>
                  <div className="bg-background relative mb-3 flex size-52 items-center justify-center rounded-xl border-2 border-dashed border-green-300 p-2 dark:border-green-700">
                    {qrDataUrl ? (
                      <img
                        src={qrDataUrl}
                        alt="WeChat QR Code"
                        className="size-full rounded-lg object-contain"
                      />
                    ) : (
                      <div className="flex flex-col items-center gap-2">
                        <Loader2 className="text-muted-foreground size-6 animate-spin" />
                        <span className="text-muted-foreground text-xs">
                          生成二维码中...
                        </span>
                      </div>
                    )}
                    {countdown <= 0 && qrExpireAt && (
                      <div className="bg-background/80 absolute inset-0 flex flex-col items-center justify-center rounded-xl backdrop-blur-sm">
                        <p className="text-muted-foreground mb-2 text-xs">
                          二维码已过期
                        </p>
                        <button
                          onClick={handleRefreshQr}
                          className="text-primary inline-flex items-center gap-1 text-xs hover:underline"
                        >
                          <RefreshCw className="size-3" />
                          {t.settings.wechatRefreshQr}
                        </button>
                      </div>
                    )}
                  </div>
                  {countdown > 0 && (
                    <p className="text-muted-foreground text-xs">
                      {t.settings.wechatExpireIn.replace(
                        '{seconds}',
                        String(countdown)
                      )}
                    </p>
                  )}
                  <button
                    onClick={() => {
                      setShowQrPanel(false);
                      stopPolling();
                    }}
                    className="text-muted-foreground hover:text-foreground mt-4 inline-flex items-center gap-1 text-xs"
                  >
                    <X className="size-3" />
                    关闭
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Feishu Card */}
      <FeishuCard />
    </div>
  );
}

// ─── Feishu Channel Card ─────────────────────────────────────────────────

type FeishuStatus = 'idle' | 'connecting' | 'connected' | 'error';

interface FeishuStatusResponse {
  status: FeishuStatus;
  errorMessage: string | null;
  connectedAt: number | null;
  hasConfig: boolean;
  enabled: boolean;
  appId: string;
  appSecretMasked: string;
  connectionMode: string;
}

function FeishuCard() {
  const { t } = useLanguage();
  const [status, setStatus] = useState<FeishuStatus>('idle');
  const [hasConfig, setHasConfig] = useState(false);
  const [appId, setAppId] = useState('');
  const [appSecretMasked, setAppSecretMasked] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [testLoading, setTestLoading] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    botName?: string;
    error?: string;
  } | null>(null);

  // Form fields
  const [formAppId, setFormAppId] = useState('');
  const [formAppSecret, setFormAppSecret] = useState('');

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/channels/feishu/status`);
      if (!res.ok) return;
      const data: FeishuStatusResponse = await res.json();
      setStatus(data.status);
      setHasConfig(data.hasConfig);
      setAppId(data.appId);
      setAppSecretMasked(data.appSecretMasked);
      setErrorMessage(data.errorMessage);

      if (data.status === 'connected') {
        stopPolling();
      }
    } catch {
      // backend not reachable
    }
  }, []);

  const startPolling = useCallback(() => {
    stopPolling();
    pollRef.current = setInterval(fetchStatus, 3000);
  }, [fetchStatus]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    return () => stopPolling();
  }, [fetchStatus, stopPolling]);

  const handleTest = async () => {
    if (!formAppId || !formAppSecret) return;
    setTestLoading(true);
    setTestResult(null);
    try {
      const res = await fetch(`${API_BASE_URL}/channels/feishu/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId: formAppId, appSecret: formAppSecret }),
      });
      const data = await res.json();
      setTestResult(data);
    } catch (err) {
      setTestResult({ ok: false, error: (err as Error).message });
    } finally {
      setTestLoading(false);
    }
  };

  const handleSave = async () => {
    if (!formAppId || !formAppSecret) return;
    setLoading(true);
    setErrorMessage(null);
    setTestResult(null);
    try {
      const res = await fetch(`${API_BASE_URL}/channels/feishu/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appId: formAppId,
          appSecret: formAppSecret,
          autoConnect: true,
        }),
      });
      const data = await res.json();

      if (!data.ok) {
        setErrorMessage(data.message || t.settings.feishuSaveFailed);
        return;
      }

      // Success
      setShowForm(false);
      setFormAppId('');
      setFormAppSecret('');
      startPolling();
      await fetchStatus();
    } catch (err) {
      setErrorMessage((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleConnect = async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const res = await fetch(`${API_BASE_URL}/channels/feishu/connect`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!data.ok) {
        setErrorMessage(data.message || t.settings.feishuConnectFailed);
      } else {
        startPolling();
      }
      await fetchStatus();
    } catch (err) {
      setErrorMessage((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    setLoading(true);
    try {
      await fetch(`${API_BASE_URL}/channels/feishu/disconnect`, {
        method: 'POST',
      });
      stopPolling();
      await fetchStatus();
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const handleOpenForm = () => {
    setFormAppId(appId || '');
    setFormAppSecret('');
    setTestResult(null);
    setShowForm(true);
  };

  const feishuStatusBadge = () => {
    switch (status) {
      case 'connected':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-600 dark:text-green-400">
            <CheckCircle2 className="size-3" />
            {t.settings.feishuConnected}
          </span>
        );
      case 'connecting':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
            <Loader2 className="size-3 animate-spin" />
            {t.settings.feishuConnecting}
          </span>
        );
      case 'error':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-600 dark:text-red-400">
            <AlertCircle className="size-3" />
            {t.settings.feishuError}
          </span>
        );
      default:
        if (hasConfig) {
          return (
            <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
              {t.settings.feishuDisconnected}
            </span>
          );
        }
        return (
          <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
            {t.settings.feishuNotConfigured}
          </span>
        );
    }
  };

  const renderActionButton = () => {
    if (status === 'connected') {
      return (
        <button
          onClick={handleDisconnect}
          disabled={loading}
          className="text-muted-foreground hover:text-foreground rounded-md border px-3 py-1.5 text-xs transition-colors"
        >
          {loading ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            t.settings.feishuDisconnect
          )}
        </button>
      );
    }

    if (hasConfig && status !== 'connecting') {
      return (
        <div className="flex items-center gap-2">
          <button
            onClick={handleConnect}
            disabled={loading}
            className={cn(
              'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              'bg-primary text-primary-foreground hover:bg-primary/90',
              loading && 'cursor-not-allowed opacity-50'
            )}
          >
            {loading ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              t.settings.feishuConnect
            )}
          </button>
          <button
            onClick={handleOpenForm}
            className="text-muted-foreground hover:text-foreground rounded-md border px-3 py-1.5 text-xs transition-colors"
          >
            {t.settings.feishuReconfigure}
          </button>
        </div>
      );
    }

    if (status === 'connecting') {
      return (
        <button
          disabled
          className="cursor-not-allowed rounded-md px-3 py-1.5 text-xs opacity-50"
        >
          <Loader2 className="size-3 animate-spin" />
        </button>
      );
    }

    return (
      <button
        onClick={handleOpenForm}
        className={cn(
          'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
          'bg-primary text-primary-foreground hover:bg-primary/90'
        )}
      >
        {t.settings.feishuConfigure}
      </button>
    );
  };

  return (
    <div className="border-border bg-background rounded-xl border">
      {/* Header */}
      <div className="flex items-center justify-between p-5">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-blue-500/10">
            <svg
              className="size-5 text-blue-600 dark:text-blue-400"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M6.3 3.3c.4-.3 1-.3 1.4 0l8 6.5c.2.2.3.4.3.7v7c0 .4-.2.7-.5.9l-3 2c-.4.3-1 .3-1.4 0l-8-6.5c-.2-.2-.3-.4-.3-.7v-7c0-.4.2-.7.5-.9l3-2zm1.2 2.4L5 7.5v5.5l6.5 5.3 1.5-1V12L6.5 6.7z" />
            </svg>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-foreground text-sm font-medium">
                {t.settings.feishuTitle}
              </span>
            </div>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {t.settings.feishuDescription}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {feishuStatusBadge()}
          {renderActionButton()}
        </div>
      </div>

      {/* Config Info (when configured but not editing) */}
      {hasConfig && !showForm && status !== 'idle' && (
        <div className="border-border border-t px-5 py-3">
          <div className="flex items-center gap-4 text-xs">
            <span className="text-muted-foreground">App ID:</span>
            <span className="text-foreground font-mono">{appId}</span>
            <span className="text-muted-foreground">App Secret:</span>
            <span className="text-foreground font-mono">{appSecretMasked}</span>
          </div>
        </div>
      )}

      {/* Error Message */}
      {errorMessage && !showForm && (
        <div className="border-border border-t px-5 py-3">
          <div className="flex items-start gap-2 rounded-lg bg-red-500/5 p-3">
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-red-500" />
            <p className="text-sm text-red-600 dark:text-red-400">
              {errorMessage}
            </p>
          </div>
        </div>
      )}

      {/* Configuration Form */}
      {showForm && (
        <div className="border-border border-t px-5 py-5">
          <div className="space-y-4">
            <p className="text-muted-foreground text-xs">
              {t.settings.feishuFormHint}
              <a
                href="https://open.feishu.cn"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary ml-1 inline-flex items-center gap-0.5 hover:underline"
              >
                {t.settings.feishuOpenPlatform}
                <ExternalLink className="size-3" />
              </a>
            </p>

            {/* App ID */}
            <div className="space-y-1.5">
              <label className="text-foreground text-xs font-medium">
                App ID
              </label>
              <input
                type="text"
                value={formAppId}
                onChange={(e) => {
                  setFormAppId(e.target.value);
                  setTestResult(null);
                }}
                placeholder="cli_xxxxxxxxxx"
                className="border-border bg-background text-foreground placeholder:text-muted-foreground w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            {/* App Secret */}
            <div className="space-y-1.5">
              <label className="text-foreground text-xs font-medium">
                App Secret
              </label>
              <input
                type="password"
                value={formAppSecret}
                onChange={(e) => {
                  setFormAppSecret(e.target.value);
                  setTestResult(null);
                }}
                placeholder={
                  hasConfig
                    ? t.settings.feishuSecretPlaceholder
                    : 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
                }
                className="border-border bg-background text-foreground placeholder:text-muted-foreground w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            {/* Test Result */}
            {testResult && (
              <div
                className={cn(
                  'flex items-start gap-2 rounded-lg p-3',
                  testResult.ok ? 'bg-green-500/5' : 'bg-red-500/5'
                )}
              >
                {testResult.ok ? (
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-green-500" />
                ) : (
                  <AlertCircle className="mt-0.5 size-4 shrink-0 text-red-500" />
                )}
                <div>
                  <p
                    className={cn(
                      'text-sm font-medium',
                      testResult.ok
                        ? 'text-green-600 dark:text-green-400'
                        : 'text-red-600 dark:text-red-400'
                    )}
                  >
                    {testResult.ok
                      ? testResult.botName
                        ? t.settings.feishuTestSuccessWithName.replace(
                            '{name}',
                            testResult.botName
                          )
                        : t.settings.feishuTestSuccess
                      : t.settings.feishuTestFailed}
                  </p>
                  {testResult.error && (
                    <p className="text-muted-foreground mt-0.5 text-xs">
                      {testResult.error}
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={handleTest}
                disabled={testLoading || !formAppId || !formAppSecret}
                className={cn(
                  'rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
                  'hover:bg-muted',
                  (testLoading || !formAppId || !formAppSecret) &&
                    'cursor-not-allowed opacity-50'
                )}
              >
                {testLoading ? (
                  <span className="inline-flex items-center gap-1">
                    <Loader2 className="size-3 animate-spin" />
                    {t.settings.feishuTesting}
                  </span>
                ) : (
                  t.settings.feishuTestConnection
                )}
              </button>

              <button
                onClick={handleSave}
                disabled={loading || !formAppId || !formAppSecret}
                className={cn(
                  'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                  'bg-primary text-primary-foreground hover:bg-primary/90',
                  (loading || !formAppId || !formAppSecret) &&
                    'cursor-not-allowed opacity-50'
                )}
              >
                {loading ? (
                  <span className="inline-flex items-center gap-1">
                    <Loader2 className="size-3 animate-spin" />
                    {t.settings.feishuSaving}
                  </span>
                ) : (
                  t.settings.feishuSaveAndConnect
                )}
              </button>

              <button
                onClick={() => {
                  setShowForm(false);
                  setTestResult(null);
                  setErrorMessage(null);
                }}
                className="text-muted-foreground hover:text-foreground ml-auto text-xs"
              >
                {t.settings.feishuCancel}
              </button>
            </div>

            {/* Chat hint */}
            <p className="text-muted-foreground border-border border-t pt-3 text-[11px]">
              {t.settings.feishuChatHint}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
