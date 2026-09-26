export type RouteName = "landing" | "verify-email" | "reset-password" | "home";

export type Route = {
  name: RouteName;
  token?: string;
};

export function routeForPath(pathname: string): RouteName {
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
  const token =
    name === "verify-email" || name === "reset-password"
      ? location.searchParams.get("token") || undefined
      : undefined;
  return { name, token };
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
