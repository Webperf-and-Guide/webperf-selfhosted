import type { ControlListQuery } from './control-plane';

export const readListQuery = (url: URL): ControlListQuery => {
  const pageSize = url.searchParams.get('pageSize');
  const pageToken = url.searchParams.get('pageToken');
  const filter = url.searchParams.get('filter');

  return {
    pageSize: pageSize ? Number(pageSize) : undefined,
    pageToken,
    filter
  };
};
