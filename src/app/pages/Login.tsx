import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/shared/providers/auth-provider';
import { cn } from '@/shared/lib/utils';

// GitHub SVG icon
function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
    </svg>
  );
}

// Google SVG icon
function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

export function LoginPage() {
  const { status, signInWithGitHub, signInWithGoogle, signInWithEmail } = useAuth();
  const [loadingProvider, setLoadingProvider] = useState<
    'github' | 'google' | 'email' | null
  >(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);

  // 如果已经登录（例如 OAuth 回调完成后），自动跳转到主页
  if (status === 'authenticated') {
    return <Navigate to="/" replace />;
  }

  const handleGitHub = async () => {
    setLoadingProvider('github');
    try {
      await signInWithGitHub();
    } finally {
      setLoadingProvider(null);
    }
  };

  const handleGoogle = async () => {
    setLoadingProvider('google');
    try {
      await signInWithGoogle();
    } finally {
      setLoadingProvider(null);
    }
  };

  const handleEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailError(null);
    setLoadingProvider('email');
    try {
      await signInWithEmail(email, password);
    } catch (err: unknown) {
      setEmailError(err instanceof Error ? err.message : '登录失败');
    } finally {
      setLoadingProvider(null);
    }
  };

  return (
    <div className="bg-background flex min-h-svh flex-col items-center justify-center px-4">
      {/* Card */}
      <div className="border-border bg-card shadow-md w-full max-w-sm rounded-2xl border p-8">
        {/* Logo + Brand */}
        <div className="mb-8 flex flex-col items-center gap-3">
          <img
            src="/logo.png"
            alt="Sage"
            className="size-12 rounded-xl object-contain"
          />
          <div className="text-center">
            <h1 className="text-foreground font-serif text-2xl font-normal tracking-tight">
              Sage
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">
              登录以开始你的金融 AI 之旅
            </p>
          </div>
        </div>

        {/* OAuth Buttons */}
        <div className="flex flex-col gap-3">
          {/* GitHub */}
          <button
            type="button"
            onClick={handleGitHub}
            disabled={loadingProvider !== null}
            className={cn(
              'border-border bg-background text-foreground hover:bg-accent',
              'inline-flex h-10 w-full items-center justify-center gap-2.5',
              'rounded-lg border px-4 text-sm font-medium transition-colors',
              'disabled:cursor-not-allowed disabled:opacity-50'
            )}
          >
            {loadingProvider === 'github' ? (
              <div className="border-foreground/30 border-t-foreground size-4 animate-spin rounded-full border-2" />
            ) : (
              <GitHubIcon className="size-4" />
            )}
            使用 GitHub 登录
          </button>

          {/* Google */}
          <button
            type="button"
            onClick={handleGoogle}
            disabled={loadingProvider !== null}
            className={cn(
              'border-border bg-background text-foreground hover:bg-accent',
              'inline-flex h-10 w-full items-center justify-center gap-2.5',
              'rounded-lg border px-4 text-sm font-medium transition-colors',
              'disabled:cursor-not-allowed disabled:opacity-50'
            )}
          >
            {loadingProvider === 'google' ? (
              <div className="border-foreground/30 border-t-foreground size-4 animate-spin rounded-full border-2" />
            ) : (
              <GoogleIcon className="size-4" />
            )}
            使用 Google 登录
          </button>
        </div>

        {/* Divider */}
        <div className="my-6 flex items-center gap-3">
          <div className="bg-border h-px flex-1" />
          <span className="text-muted-foreground text-xs">或使用邮箱登录</span>
          <div className="bg-border h-px flex-1" />
        </div>

        {/* Email/Password Form */}
        <form onSubmit={handleEmail} className="flex flex-col gap-3">
          <input
            type="email"
            placeholder="邮箱"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className={cn(
              'border-border bg-background text-foreground placeholder:text-muted-foreground',
              'h-10 w-full rounded-lg border px-3 text-sm outline-none',
              'focus:ring-ring focus:ring-2'
            )}
          />
          <input
            type="password"
            placeholder="密码"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className={cn(
              'border-border bg-background text-foreground placeholder:text-muted-foreground',
              'h-10 w-full rounded-lg border px-3 text-sm outline-none',
              'focus:ring-ring focus:ring-2'
            )}
          />
          {emailError && (
            <p className="text-xs text-red-500">{emailError}</p>
          )}
          <button
            type="submit"
            disabled={loadingProvider !== null}
            className={cn(
              'bg-foreground text-background hover:bg-foreground/90',
              'inline-flex h-10 w-full items-center justify-center gap-2',
              'rounded-lg px-4 text-sm font-medium transition-colors',
              'disabled:cursor-not-allowed disabled:opacity-50'
            )}
          >
            {loadingProvider === 'email' ? (
              <div className="border-background/30 border-t-background size-4 animate-spin rounded-full border-2" />
            ) : (
              '登录'
            )}
          </button>
        </form>

        {/* Footer note */}
        <p className="text-muted-foreground text-center text-xs leading-relaxed">
          登录即表示你同意我们的服务条款和隐私政策。
          <br />
          你的数据仅用于提升个人使用体验。
        </p>
      </div>

      {/* Bottom brand */}
      <p className="text-muted-foreground mt-6 text-xs">
        Sage · AI Financial Assistant
      </p>
    </div>
  );
}
