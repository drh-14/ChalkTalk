export type RouteName =
  | "landing"
  | "verify-email"
  | "reset-password"
  | "home"
  | "course"
  | "post"
  | "course-settings";

export type FeedFilters = {
  type?: "question" | "note";
  answered?: false;
  tag?: string;
  sort?: "newest" | "recent_activity";
};

export type Route = {
  name: RouteName;
  token?: string;
  courseId?: string;
  postId?: string;
  query?: string;
  filters?: FeedFilters;
};

const FILTER_KEYS = ["type", "answered", "tag", "sort"] as const;

/** Reads feed filters from a URL, ignoring unknown or invalid values. */
export function filtersFromSearch(params: URLSearchParams): FeedFilters {
  const filters: FeedFilters = {};
  if (params.get("answered") === "false") filters.answered = false;
  else {
    const type = params.get("type");
    if (type === "question" || type === "note") filters.type = type;
  }
  const tag = params.get("tag")?.trim();
  if (tag) filters.tag = tag.slice(0, 40);
  const sort = params.get("sort");
  if (sort === "newest" || sort === "recent_activity") filters.sort = sort;
  return filters;
}

export function hasFilters(filters: FeedFilters | undefined): boolean {
  return Boolean(
    filters &&
    (filters.type || filters.answered === false || filters.tag || filters.sort),
  );
}

/** Serializes a search query and feed filters as a URL search string. */
export function feedSearch(query?: string, filters?: FeedFilters): string {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (filters?.answered === false) params.set("answered", "false");
  else if (filters?.type) params.set("type", filters.type);
  if (filters?.tag) params.set("tag", filters.tag);
  if (filters?.sort) params.set("sort", filters.sort);
  return params.size ? `?${params}` : "";
}

export function routeForPath(pathname: string): RouteName {
  if (/^\/courses\/[^/]+\/posts\/[^/]+$/.test(pathname)) return "post";
  if (/^\/courses\/[^/]+\/settings$/.test(pathname)) return "course-settings";
  if (/^\/courses\/[^/]+$/.test(pathname)) return "course";
  switch (pathname) {
    case "/verify-email":
      return "verify-email";
    case "/reset-password":
      return "reset-password";
    case "/home":
      return "home";
    default:
      return "landing";
  }
}

export function routeFromLocation(location: URL): Route {
  const name = routeForPath(location.pathname);
  if (name === "landing" || name === "home") return { name, token: undefined };
  if (name === "verify-email" || name === "reset-password")
    return { name, token: location.searchParams.get("token") || undefined };
  const parts = location.pathname.split("/");
  const courseId = parts[2];
  if (name === "course-settings") return { name, courseId };
  const query = location.searchParams.get("q") || undefined;
  const filters = filtersFromSearch(location.searchParams);
  return {
    name,
    courseId,
    ...(name === "post" ? { postId: parts[4] } : {}),
    ...(query ? { query } : {}),
    ...(hasFilters(filters) ? { filters } : {}),
  };
}

export function initializeRoute(location: URL, history: History): Route {
  const route = routeFromLocation(location);
  const { token } = route;
  if (token) history.replaceState(null, "", location.pathname);
  return route;
}

export function navigate(pathname: string): void {
  window.history.pushState(null, "", pathname);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function replaceCurrentQuery(query: string): void {
  const url = new URL(window.location.href);
  if (query) url.searchParams.set("q", query);
  else url.searchParams.delete("q");
  window.history.replaceState(
    null,
    "",
    `${url.pathname}${url.search}${url.hash}`,
  );
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/** Replaces the feed filters in the current URL, keeping the search query. */
export function replaceCurrentFilters(filters: FeedFilters): void {
  const url = new URL(window.location.href);
  for (const key of FILTER_KEYS) url.searchParams.delete(key);
  const next = new URLSearchParams(feedSearch(undefined, filters));
  for (const [key, value] of next) url.searchParams.set(key, value);
  window.history.replaceState(
    null,
    "",
    `${url.pathname}${url.search}${url.hash}`,
  );
  window.dispatchEvent(new PopStateEvent("popstate"));
}
