// Ported from runner: only the caller's latest request may reach this policy.
export interface BrowseListState<T> {
  items: T[];
  page: number;
  hasMore: boolean;
  error: string | null;
  loadMoreError: string | null;
}

export function initialBrowseListState<T>(): BrowseListState<T> {
  return { items: [], page: 1, hasMore: false, error: null, loadMoreError: null };
}

export interface BrowsePageResponse<T> {
  ok: boolean;
  result: T[] | null;
  msg: string;
  hasNext: boolean | undefined;
}

export function applyBrowsePage<T>(
  state: BrowseListState<T>,
  args: { append: boolean; page: number },
  res: BrowsePageResponse<T>,
): BrowseListState<T> {
  if (res.ok && res.result) {
    return {
      items: args.append ? [...state.items, ...res.result] : res.result,
      page: args.page,
      hasMore: res.hasNext ?? false,
      error: null,
      loadMoreError: null,
    };
  }
  if (args.append) {
    // Preserve both the loaded tail and the page to retry on failure.
    return { ...state, loadMoreError: res.msg };
  }
  return {
    items: [], page: args.page, hasMore: false,
    error: res.msg, loadMoreError: null,
  };
}
