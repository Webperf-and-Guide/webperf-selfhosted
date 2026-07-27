import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// Phase 1 of issue #14: Region Packs were removed. The console proxy returns
// 410 Gone so stale UI/clients fail fast. The managed Cloud product may keep
// its own managed-region catalog outside this repository.
const GONE_BODY = {
  error:
    'Region packs were removed in Phase 1 of issue #14. One standalone deployment measures from one runtime location.'
} as const;

export const GET: RequestHandler = async () => json(GONE_BODY, { status: 410 });

export const POST: RequestHandler = async () => json(GONE_BODY, { status: 410 });
