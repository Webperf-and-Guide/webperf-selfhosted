import type { ListQuery } from '@webperf/contracts';

export const readListQuery = (url: URL): ListQuery => {
  const pageSize = url.searchParams.get('pageSize');
  const pageToken = url.searchParams.get('pageToken');
  const filter = url.searchParams.get('filter');

  return {
    pageSize: pageSize ? Number(pageSize) : 20,
    pageToken: pageToken ?? undefined,
    filter: filter ?? undefined
  };
};
