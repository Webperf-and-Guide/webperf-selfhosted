export type ControlListQuery = {
  pageSize?: number;
  pageToken?: string | null;
  filter?: string | null;
};

export const toControlListSearch = (query: ControlListQuery) => {
  const search = new URLSearchParams();

  if (query.pageSize != null) {
    search.set('pageSize', String(query.pageSize));
  }

  if (query.pageToken) {
    search.set('pageToken', query.pageToken);
  }

  if (query.filter) {
    search.set('filter', query.filter);
  }

  const value = search.toString();
  return value.length > 0 ? `?${value}` : '';
};

export const fetchControlJson = async <T>(path: string, query: ControlListQuery = {}): Promise<T> => {
  const response = await fetch(`/api/control/${path}${toControlListSearch(query)}`);
  const payload = (await response.json()) as T & { error?: string };

  if (!response.ok) {
    throw new Error(payload.error ?? `Failed to fetch ${path}`);
  }

  return payload;
};
