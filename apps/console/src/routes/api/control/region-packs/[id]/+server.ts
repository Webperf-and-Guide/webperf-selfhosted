import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// Phase 1 of issue #14: Region Packs were removed. The console proxy returns
// 410 Gone for every method on the per-id route.
const GONE_BODY = {
  error: 'Region packs were removed in Phase 1 of issue #14.'
} as const;

export const GET: RequestHandler = async () => json(GONE_BODY, { status: 410 });
export const PUT: RequestHandler = async () => json(GONE_BODY, { status: 410 });
export const DELETE: RequestHandler = async () => json(GONE_BODY, { status: 410 });
