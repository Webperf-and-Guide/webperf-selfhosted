/// <reference types="@cloudflare/workers-types" />

type PlatformEnv = Partial<Cloudflare.Env> & {
  CONTROL_BASE_URL?: string;
  DEPLOY_TARGET?: string;
  TURNSTILE_SITE_KEY?: string;
};

declare global {
  namespace App {
    interface Platform {
      env?: PlatformEnv;
    }
  }
}

export {};
