/// <reference types="vite/client" />

declare const __BUILD_DATE__: string;
declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  /** Supabase project URL（dev / prod 分离） */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase anon / public key */
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
