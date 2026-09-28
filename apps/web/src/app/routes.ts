export type RouteName =
  | "landing"
  | "verify-email"
  | "reset-password"
  | "home"
  | "course"
  | "post"
  | "course-settings";

export type Route = {
  name: RouteName;
  token?: string;
  courseId?: string;
  postId?: string;
  query?: string;
};

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
  return {
    name,
    courseId,
    ...(name === "post" ? { postId: parts[4] } : {}),
    ...(query ? { query } : {}),
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
