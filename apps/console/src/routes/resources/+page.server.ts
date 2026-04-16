import type { PageServerLoad } from './$types';
import { loadConsolePage } from '$lib/server/load-console-page';

export const load: PageServerLoad = async ({ fetch, platform }) => loadConsolePage({ fetch, platform });
