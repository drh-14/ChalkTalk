import { POST_TYPES } from "../posts/types.js";

export type RouteName =
  | "landing"
  | "verify-email"
  | "reset-password"
  | "home"
  | "course"
  | "post"
  | "course-settings"
  | "course-resources";

export type FeedSort = "relevance" | "newest" | "oldest" | "recent_activity";
/** Feed state kept in the URL: a sidebar filter key, tags, a tag match, and a chosen sort. */
export type FeedFilters = {
  filter?: string;
  tags?: string[];
  /** Only the non-default choice is kept; several tags otherwise match all. */
  tagMatch?: "any";
  sort?: FeedSort;
};

/** The API accepts at most this many tags in one feed request. */
export const MAX_FEED_TAGS = 10;

export type Route = {
  name: RouteName;
  token?: string;
  courseId?: string;
  postId?: string;
  query?: string;
  filters?: FeedFilters;
};

const FILTER_KEYS = ["filter", "tag", "tagMatch", "sort"] as const;
const FILTER_VALUES = new Set([
  "mine",
  "instructors",
  "tas",
  ...Object.keys(POST_TYPES),
]);
const SORTS: readonly FeedSort[] = [
  "relevance",
  "newest",
  "oldest",
  "recent_activity",
];

/** Reads feed filters from a URL, ignoring unknown or invalid values. */
export function filtersFromSearch(params: URLSearchParams): FeedFilters {
  const filters: FeedFilters = {};
  const filter = params.get("filter");
  if (filter && FILTER_VALUES.has(filter)) filters.filter = filter;
  const tags: string[] = [];
  for (const raw of params.getAll("tag")) {
    const tag = raw.trim().slice(0, 40);
    if (tag && !hasTag(tags, tag) && tags.length < MAX_FEED_TAGS)
      tags.push(tag);
  }
  if (tags.length) filters.tags = tags;
  if (tags.length > 1 && params.get("tagMatch") === "any")
    filters.tagMatch = "any";
  const sort = params.get("sort");
  if (sort && (SORTS as readonly string[]).includes(sort))
    filters.sort = sort as FeedSort;
  return filters;
}

/** Tags compare case-insensitively, as the API does. */
export function hasTag(tags: readonly string[] | undefined, tag: string) {
  const key = tag.toLowerCase();
  return Boolean(tags?.some((item) => item.toLowerCase() === key));
}

export function hasFilters(filters: FeedFilters | undefined): boolean {
  return Boolean(
    filters && (filters.filter || filters.tags?.length || filters.sort),
  );
}

/** Serializes a search query and feed filters as a URL search string. */
export function feedSearch(query?: string, filters?: FeedFilters): string {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (filters?.filter) params.set("filter", filters.filter);
  for (const tag of filters?.tags ?? []) params.append("tag", tag);
  if (filters?.tagMatch === "any" && (filters.tags?.length ?? 0) > 1)
    params.set("tagMatch", "any");
  if (filters?.sort) params.set("sort", filters.sort);
  return params.size ? `?${params}` : "";
}

export function routeForPath(pathname: string): RouteName {
  if (/^\/courses\/[^/]+\/posts\/[^/]+$/.test(pathname)) return "post";
  if (/^\/courses\/[^/]+\/settings$/.test(pathname)) return "course-settings";
  if (/^\/courses\/[^/]+\/resources$/.test(pathname)) return "course-resources";
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
  if (name === "course-settings" || name === "course-resources")
    return { name, courseId };
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
  // A sort is chosen for one search; a new or cleared search returns to its default.
  if ((url.searchParams.get("q") ?? "") !== query)
    url.searchParams.delete("sort");
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
  for (const [key, value] of new URLSearchParams(
    feedSearch(undefined, filters),
  ))
    url.searchParams.append(key, value);
  window.history.replaceState(
    null,
    "",
    `${url.pathname}${url.search}${url.hash}`,
  );
  window.dispatchEvent(new PopStateEvent("popstate"));
}
