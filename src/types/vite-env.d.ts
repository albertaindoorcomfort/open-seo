/// <reference types="vite/client" />
interface ViteTypeOptions {
  // By adding this line, you can make the type of ImportMetaEnv strict
  // to disallow unknown keys.
  strictImportMetaEnv: unknown;
}

interface ImportMetaEnv {
  readonly VITE_SHOW_DEVTOOLS?: string;
  readonly VITE_BRAND?: string;
  readonly VITE_BRAND_SUPPORT_EMAIL?: string;
  readonly BYPASS_EMAIL_VERIFICATION?: string;
  // more env variables...
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
