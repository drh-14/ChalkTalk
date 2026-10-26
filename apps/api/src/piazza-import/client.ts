import type { PiazzaExport, PiazzaPost, PiazzaUser } from "./convert.js";

type Network = {
  id: string;
  name: string;
  course_number?: string;
  term?: string;
};
type Log = (message: string) => void;

/** A logged-in session against Piazza's internal web API (the one its own site uses). */
export class PiazzaClient {
  private readonly cookies = new Map<string, string>();
  private last = 0;

  constructor(
    private readonly options: {
      /** Minimum milliseconds between requests, to stay polite. */
      delayMs?: number;
      fetch?: typeof fetch;
    } = {},
  ) {}

  private get fetch() {
    return this.options.fetch ?? fetch;
  }

  private remember(response: Response) {
    for (const line of response.headers.getSetCookie?.() ?? []) {
      const [pair = ""] = line.split(";");
      const at = pair.indexOf("=");
      if (at > 0)
        this.cookies.set(pair.slice(0, at).trim(), pair.slice(at + 1).trim());
    }
  }

  private cookie() {
    return [...this.cookies]
      .map(([key, value]) => `${key}=${value}`)
      .join("; ");
  }

  private async pace() {
    const wait = this.last + (this.options.delayMs ?? 1000) - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    this.last = Date.now();
  }

  async login(email: string, password: string): Promise<void> {
    await this.pace();
    const page = await this.fetch("https://piazza.com/main/csrf_token");
    this.remember(page);
    const csrf = (await page.text()).match(/CSRF_TOKEN\s*=\s*"([^"]+)"/)?.[1];
    await this.pace();
    const response = await this.fetch("https://piazza.com/class", {
      method: "POST",
      redirect: "manual",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: this.cookie(),
        ...(csrf ? { "CSRF-Token": csrf } : {}),
      },
      body: new URLSearchParams({
        from: "/signup",
        email,
        password,
        remember: "on",
      }),
    });
    this.remember(response);
    if (!this.cookies.has("session_id"))
      throw new Error(
        "Piazza login failed; check PIAZZA_EMAIL and PIAZZA_PASSWORD",
      );
  }

  async call<T>(method: string, params: Record<string, unknown>): Promise<T> {
    await this.pace();
    const response = await this.fetch(
      `https://piazza.com/logic/api?method=${encodeURIComponent(method)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: this.cookie(),
          "CSRF-Token": this.cookies.get("session_id") ?? "",
        },
        body: JSON.stringify({ method, params }),
      },
    );
    this.remember(response);
    const json = (await response.json().catch(() => null)) as {
      result?: T;
      error?: string | null;
    } | null;
    if (!json || json.error || json.result === undefined)
      throw new Error(
        `Piazza ${method} failed: ${json?.error ?? response.status}`,
      );
    return json.result;
  }

  /** Fetches every post the logged-in account can see in the class matching `query`. */
  async exportClass(query: string, log: Log = () => {}): Promise<PiazzaExport> {
    const status = await this.call<{ id?: string; networks?: Network[] }>(
      "user.status",
      {},
    );
    const needle = query.toLowerCase().replace(/\s+/g, " ").trim();
    const matches = (status.networks ?? []).filter((network) =>
      `${network.course_number ?? ""} ${network.name} ${network.id}`
        .toLowerCase()
        .replace(/\s+/g, " ")
        .includes(needle),
    );
    if (matches.length !== 1)
      throw new Error(
        matches.length
          ? `"${query}" matches several Piazza classes: ${matches.map((n) => `${n.course_number ?? n.name} (${n.term ?? n.id})`).join(", ")}`
          : `No Piazza class matches "${query}"`,
      );
    const network = matches[0]!;
    log(
      `Exporting ${network.course_number ?? network.name} ${network.term ?? ""}`,
    );

    const feed: { id: string; pin?: number | boolean }[] = [];
    for (let offset = 0; ; offset += 100) {
      const page = await this.call<{
        feed?: { id: string; pin?: number | boolean }[];
        more?: boolean;
      }>("network.get_my_feed", {
        nid: network.id,
        offset,
        limit: 100,
        sort: "updated",
      });
      feed.push(...(page.feed ?? []));
      if (!page.more || !page.feed?.length) break;
    }
    log(`Found ${feed.length} posts`);

    const posts: PiazzaPost[] = [];
    for (const [index, item] of feed.entries()) {
      const post = await this.call<PiazzaPost>("content.get", {
        cid: item.id,
        nid: network.id,
      });
      posts.push({ ...post, pinned: Boolean(item.pin) });
      if ((index + 1) % 25 === 0 || index + 1 === feed.length)
        log(`Fetched ${index + 1}/${feed.length} posts`);
    }

    const uids = new Set<string>();
    const collect = (node: {
      uid?: string;
      history?: { uid?: string }[];
      children?: unknown[];
      tag_endorse?: { id: string }[];
      tag_good?: { id: string }[];
    }) => {
      if (node.uid) uids.add(node.uid);
      for (const entry of node.history ?? [])
        if (entry.uid) uids.add(entry.uid);
      for (const user of [
        ...(node.tag_endorse ?? []),
        ...(node.tag_good ?? []),
      ])
        uids.add(user.id);
      for (const child of node.children ?? []) collect(child as typeof node);
    };
    for (const post of posts) collect(post);
    if (status.id) uids.add(status.id);
    const users: PiazzaUser[] = [];
    const ids = [...uids];
    for (let at = 0; at < ids.length; at += 50) {
      users.push(
        ...(await this.call<PiazzaUser[]>("network.get_users", {
          ids: ids.slice(at, at + 50),
          nid: network.id,
        })),
      );
    }
    log(`Resolved ${users.length} of ${ids.length} people`);
    return {
      network: {
        id: network.id,
        name: network.name,
        ...(network.course_number
          ? { courseNumber: network.course_number }
          : {}),
        ...(network.term ? { term: network.term } : {}),
      },
      selfUid: status.id ?? null,
      users: users.map(({ id, name, role }) => ({
        id,
        ...(name !== undefined ? { name } : {}),
        ...(role !== undefined ? { role } : {}),
      })),
      posts,
    };
  }
}
