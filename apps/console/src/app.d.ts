/// <reference types="@cloudflare/workers-types" />

type PlatformEnv = Partial<Cloudflare.Env> & {
  CONTROL_BASE_URL?: string;
  EDGE_CONTROL_BASE_URL?: string;
  CONTROL_BINDING_MODE?: 'auto' | 'disabled';
  DEPLOY_TARGET?: string;
  TURNSTILE_SITE_KEY?: string;
  EDGE_CONTROL?: unknown;
};

declare global {
  namespace App {
    interface Platform {
      env?: PlatformEnv;
    }
  }
}

export {};
