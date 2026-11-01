import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type * as Y from "yjs";
import type { ConnectOptions } from "./connection.js";
import { SessionView } from "./SessionView.js";

const whiteboard = vi.hoisted(() => ({ loaded: 0, mounted: 0 }));
vi.mock("./Whiteboard.js", async () => {
  whiteboard.loaded += 1;
  const { useEffect } = await import("react");
  return {
    default: function FakeWhiteboard(props: {
      board: Y.Map<unknown>;
      readOnly: boolean;
      visible: boolean;
    }) {
      useEffect(() => {
        whiteboard.mounted += 1;
      }, []);
      return (
        <div
          data-testid="whiteboard"
          data-read-only={String(props.readOnly)}
          data-visible={String(props.visible)}
        >
          {[...props.board.keys()].join(",")}
        </div>
      );
    },
  };
});

const session = {
  id: "s-1",
  courseId: "c-1",
  status: "active",
  finalSnapshotConfirmed: true,
  title: "Why does my loop never stop?",
  language: "python",
  createdBy: "alice",
  participants: [
    { userId: "alice", displayName: "Alice", role: "creator" },
    { userId: "bob", displayName: "Bob", role: "invitee" },
  ],
  endedAt: null,
  createdAt: "2026-10-19T00:00:00Z",
  updatedAt: "2026-10-19T00:00:00Z",
  version: 2,
};
const members = [
  {
    id: "m1",
    courseId: "c-1",
    user: { id: "alice", displayName: "Alice" },
    role: "student",
  },
  {
    id: "m2",
    courseId: "c-1",
    user: { id: "bob", displayName: "Bob" },
    role: "student",
  },
  {
    id: "m3",
    courseId: "c-1",
    user: { id: "tim", displayName: "Tim" },
    role: "ta",
  },
];
const json = (
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

type Calls = { url: string; init?: RequestInit }[];
function api(
  overrides: {
    session?: object;
    sessionStatus?: number;
    snapshot?: string;
    whiteboard?: object[];
    lastSavedWarning?: boolean;
    snapshotFailures?: number;
    ticketPermission?: "read" | "write";
  } = {},
) {
  const calls: Calls = [];
  let snapshotFailures = overrides.snapshotFailures ?? 0;
  let current = { ...session, ...overrides.session };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const method = init?.method ?? "GET";
      if (url === "/api/v1/collaboration-sessions/s-1" && method === "GET")
        return overrides.sessionStatus
          ? json(
              { error: { code: "not_found", message: "Not found" } },
              overrides.sessionStatus,
            )
          : json({ data: current }, 200, { ETag: `"v${current.version}"` });
      if (url.endsWith("/connection-tickets"))
        return json(
          {
            data: {
              ticket: `ticket-${calls.filter((c) => c.url.endsWith("/connection-tickets")).length}`,
              webSocketUrl: "wss://app.example.edu/collaboration",
              documentId: "collaboration-session:s-1",
              expiresAt: "2026-10-19T00:05:00Z",
              permission: overrides.ticketPermission ?? "write",
            },
          },
          201,
        );
      if (url.endsWith("/snapshot")) {
        if (snapshotFailures-- > 0)
          return json(
            { error: { code: "snapshot_unavailable", message: "Unavailable" } },
            503,
          );
        return json({
          data: {
            content: overrides.snapshot ?? "final code",
            whiteboard: overrides.whiteboard ?? [],
            sessionStatus: "ended",
            lastSavedWarning: overrides.lastSavedWarning ?? false,
            finalSnapshotConfirmed: !(overrides.lastSavedWarning ?? false),
          },
        });
      }
      if (url.startsWith("/api/v1/courses/c-1/members"))
        return json({
          data: members,
          page: { nextCursor: null, hasMore: false },
        });
      if (url.endsWith("/participants") && method === "POST") {
        current = {
          ...current,
          version: current.version + 1,
          participants: [
            ...current.participants,
            { userId: "tim", displayName: "Tim", role: "invitee" },
          ],
        };
        return json({ data: current }, 200, { ETag: `"v${current.version}"` });
      }
      if (url === "/api/v1/collaboration-sessions/s-1" && method === "PATCH") {
        const body = JSON.parse(String(init!.body));
        current = { ...current, ...body, version: current.version + 1 };
        return json({ data: current }, 200, { ETag: `"v${current.version}"` });
      }
      return json({ error: { code: "unexpected", message: url } }, 500);
    }),
  );
  return calls;
}

function fakeConnect() {
  const opened: { options?: ConnectOptions; destroyed: boolean } = {
    destroyed: false,
  };
  const connect = vi.fn((options: ConnectOptions) => {
    opened.options = options;
    return {
      awareness: null,
      destroy: () => {
        opened.destroyed = true;
      },
    };
  });
  return { connect, opened };
}

function view(
  viewerId: string,
  connect: ReturnType<typeof fakeConnect>["connect"],
  staff = false,
) {
  const navigate = vi.fn();
  render(
    <SessionView
      courseId="c-1"
      sessionId="s-1"
      viewerId={viewerId}
      staff={staff}
      csrfToken="csrf"
      onNavigate={navigate}
      connect={connect}
    />,
  );
  return navigate;
}
const status = () =>
  document.querySelector(".session-state")?.textContent ?? null;
const editor = () => document.querySelector(".cm-content") as HTMLElement;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("moves through connecting, connected, and reconnecting, refreshing the ticket on reconnect", async () => {
  api();
  const { connect, opened } = fakeConnect();
  view("bob", connect);
  await waitFor(() => expect(connect).toHaveBeenCalled());
  expect(status()).toBe("Connecting…");
  expect(opened.options!.url).toBe("wss://app.example.edu/collaboration");
  expect(opened.options!.name).toBe("collaboration-session:s-1");
  expect(await opened.options!.token()).toBe("ticket-1");
  act(() => opened.options!.onSynced());
  expect(status()).toBe("Connected");
  expect(editor().getAttribute("contenteditable")).toBe("true");
  act(() => opened.options!.onStatus("disconnected"));
  expect(status()).toBe("Reconnecting…");
  expect(await opened.options!.token()).toBe("ticket-2");
  act(() => opened.options!.onSynced());
  expect(status()).toBe("Connected");
});

it("becomes read-only with the final snapshot when the session ends", async () => {
  api({ snapshot: "while True:\n    break" });
  const { connect, opened } = fakeConnect();
  view("bob", connect);
  await waitFor(() => expect(connect).toHaveBeenCalled());
  act(() => opened.options!.onSynced());
  act(() => opened.options!.onClose("session-ended"));
  await waitFor(() => expect(status()).toBe("Session ended (read-only)"));
  await waitFor(() =>
    expect(
      [...document.querySelectorAll(".cm-line")]
        .map((line) => line.textContent)
        .join("\n"),
    ).toBe("while True:\n    break"),
  );
  expect(editor().getAttribute("contenteditable")).toBe("false");
  expect(opened.destroyed).toBe(true);
});

it("shows an access-removed state and stops the connection", async () => {
  api();
  const { connect, opened } = fakeConnect();
  view("bob", connect);
  await waitFor(() => expect(connect).toHaveBeenCalled());
  act(() => opened.options!.onSynced());
  act(() => opened.options!.onClose("access-removed"));
  await waitFor(() =>
    expect(status()).toBe("You no longer have access to this session"),
  );
  expect(opened.destroyed).toBe(true);
  expect(editor()).toBeNull();
});

it("opens an ended session read-only without connecting", async () => {
  api({ session: { status: "ended", endedAt: "2026-10-19T01:00:00Z" } });
  const { connect } = fakeConnect();
  view("bob", connect);
  await waitFor(() => expect(status()).toBe("Session ended (read-only)"));
  expect(connect).not.toHaveBeenCalled();
});

it("lets any participant invite, but only creator or participating staff manage", async () => {
  api();
  const invitee = fakeConnect();
  view("bob", invitee.connect);
  await screen.findByRole("heading", { name: "Why does my loop never stop?" });
  expect(screen.queryByRole("button", { name: "End session" })).toBeNull();
  expect(await screen.findByRole("button", { name: "+ Invite" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Remove Bob" })).toBeNull();
  cleanup();

  api({
    session: {
      participants: [
        ...session.participants,
        {
          userId: "tim",
          displayName: "Tim",
          role: "invitee",
          permission: "view",
        },
      ],
    },
  });
  const staff = fakeConnect();
  view("tim", staff.connect, true);
  await screen.findByRole("button", { name: "End session" });
  expect(screen.getByRole("button", { name: "Remove Bob" })).toBeTruthy();
  expect(screen.getByLabelText("Language")).toBeTruthy();
});

it("invites from course members who are not yet participants", async () => {
  const calls = api();
  const { connect } = fakeConnect();
  view("alice", connect);
  await userEvent.click(
    await screen.findByRole("button", { name: "+ Invite" }),
  );
  const picker = (await screen.findByLabelText(
    "Invite a course member",
  )) as HTMLSelectElement;
  await waitFor(() => expect(picker.disabled).toBe(false));
  const options = within(picker)
    .getAllByRole("option")
    .map((option) => option.textContent);
  expect(options).toEqual(["Choose a member", "Tim (TA)"]);
  const user = userEvent.setup();
  await user.selectOptions(picker, "tim");
  await user.click(screen.getByRole("button", { name: "Invite" }));
  await screen.findByText(/^Tim/);
  const invite = calls.find((call) => call.url.endsWith("/participants"))!;
  expect(JSON.parse(String(invite.init!.body))).toEqual({
    userId: "tim",
    permission: "edit",
  });
  expect(invite.init!.headers).toMatchObject({ "X-CSRF-Token": "csrf" });
});

it("loads invitees beyond the former ten-page roster limit", async () => {
  api();
  const original = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith("/api/v1/courses/c-1/members")) {
        const cursor = new URL(url, "https://example.edu").searchParams.get(
          "cursor",
        );
        const page = cursor ? Number(cursor) : 0;
        return json({
          data: [
            {
              id: `m-${page}`,
              courseId: "c-1",
              user: { id: `user-${page}`, displayName: `Member ${page}` },
              role: "student",
            },
          ],
          page: {
            nextCursor: page < 11 ? String(page + 1) : null,
            hasMore: page < 11,
          },
        });
      }
      return original(url, init);
    }),
  );
  const { connect } = fakeConnect();
  view("alice", connect);
  await userEvent.click(
    await screen.findByRole("button", { name: "+ Invite" }),
  );
  const picker = await screen.findByLabelText("Invite a course member");
  expect(
    await within(picker).findByRole("option", { name: "Member 11 (student)" }),
  ).toBeTruthy();
});

it("offers retry when the invitee roster request fails", async () => {
  api();
  const original = globalThis.fetch;
  let failures = 1;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith("/api/v1/courses/c-1/members") && failures-- > 0)
        return json(
          { error: { code: "unavailable", message: "Roster unavailable" } },
          503,
        );
      return original(url, init);
    }),
  );
  const { connect } = fakeConnect();
  view("alice", connect);
  await userEvent.click(
    await screen.findByRole("button", { name: "+ Invite" }),
  );
  expect(
    await screen.findByText("Could not load course members."),
  ).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Retry members" }));
  expect(
    await within(screen.getByLabelText("Invite a course member")).findByRole(
      "option",
      { name: "Tim (TA)" },
    ),
  ).toBeTruthy();
});

it("changes the language and ends the session with the current ETag", async () => {
  const calls = api();
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const { connect, opened } = fakeConnect();
  view("alice", connect);
  await waitFor(() => expect(connect).toHaveBeenCalled());
  act(() => opened.options!.onSynced());
  const user = userEvent.setup();
  await user.selectOptions(screen.getByLabelText("Language"), "java");
  await waitFor(() =>
    expect(
      document.querySelector(".code-editor")?.getAttribute("data-language"),
    ).toBe("java"),
  );
  await user.click(screen.getByRole("button", { name: "End session" }));
  await waitFor(() => expect(status()).toBe("Session ended (read-only)"));
  const patches = calls.filter((call) => call.init?.method === "PATCH");
  expect(
    patches.map(
      (call) => (call.init!.headers as Record<string, string>)["If-Match"],
    ),
  ).toEqual(['"v2"', '"v3"']);
  expect(JSON.parse(String(patches[1]!.init!.body))).toEqual({
    status: "ended",
  });
});

it("reveals nothing about a session the viewer cannot open", async () => {
  api({ sessionStatus: 404 });
  const { connect } = fakeConnect();
  view("carol", connect);
  await screen.findByRole("heading", { name: "This session isn't available" });
  expect(screen.queryByText(/loop/)).toBeNull();
  expect(screen.queryByText("Alice")).toBeNull();
  expect(connect).not.toHaveBeenCalled();
});

it("refetches the session when the server announces an update", async () => {
  const calls = api();
  const { connect, opened } = fakeConnect();
  view("bob", connect);
  await waitFor(() => expect(connect).toHaveBeenCalled());
  const reads = () =>
    calls.filter((call) => call.url === "/api/v1/collaboration-sessions/s-1")
      .length;
  const before = reads();
  act(() =>
    opened.options!.onStateless(JSON.stringify({ type: "session-updated" })),
  );
  await waitFor(() => expect(reads()).toBe(before + 1));
});

it("binds the editor to the connection document", async () => {
  api();
  const { connect, opened } = fakeConnect();
  view("bob", connect);
  await waitFor(() => expect(connect).toHaveBeenCalled());
  act(() => opened.options!.onSynced());
  act(() => {
    (opened.options!.document as Y.Doc).getText("content").insert(0, "x = 1");
  });
  await waitFor(() =>
    expect(document.querySelector(".cm-line")?.textContent).toBe("x = 1"),
  );
});

it("shows the viewer as online while connected", async () => {
  api();
  const { connect, opened } = fakeConnect();
  view("bob", connect);
  await waitFor(() => expect(connect).toHaveBeenCalled());
  expect(screen.getByText(/Bob \(you\)/).textContent).toContain(", offline");
  act(() => opened.options!.onSynced());
  expect(screen.getByText(/Bob \(you\)/).textContent).toContain(", online");
});

it("switches between code and whiteboard without reconnecting or remounting the editor", async () => {
  api();
  const { connect, opened } = fakeConnect();
  view("bob", connect);
  await waitFor(() => expect(connect).toHaveBeenCalled());
  act(() => opened.options!.onSynced());
  const code = screen.getByRole("tab", { name: "Code" });
  const board = screen.getByRole("tab", { name: "Whiteboard" });
  expect(code.getAttribute("aria-selected")).toBe("true");
  expect(whiteboard.loaded).toBe(0);
  const editorNode = editor();

  await userEvent.click(board);
  const shown = await screen.findByTestId("whiteboard");
  expect(whiteboard.loaded).toBe(1);
  expect(board.getAttribute("aria-selected")).toBe("true");
  expect(shown.dataset.visible).toBe("true");
  expect(shown.dataset.readOnly).toBe("false");
  expect(editorNode.closest("[role=tabpanel]")?.hasAttribute("hidden")).toBe(
    true,
  );

  await userEvent.click(code);
  expect(editor()).toBe(editorNode);
  expect(shown.dataset.visible).toBe("false");
  code.focus();
  await userEvent.keyboard("{ArrowRight}");
  expect(document.activeElement).toBe(board);
  expect(whiteboard.mounted).toBe(1);
  expect(connect).toHaveBeenCalledTimes(1);
  expect(opened.destroyed).toBe(false);
  expect(status()).toBe("Connected");
});

it("shows the final whiteboard read-only after the session ends", async () => {
  api({
    whiteboard: [
      { id: "r1", type: "rectangle", index: "a0" },
      { id: "t1", type: "text", index: "a1" },
    ],
  });
  const { connect, opened } = fakeConnect();
  view("bob", connect);
  await waitFor(() => expect(connect).toHaveBeenCalled());
  act(() => opened.options!.onSynced());
  await userEvent.click(screen.getByRole("tab", { name: "Whiteboard" }));
  act(() => opened.options!.onClose("session-ended"));
  await waitFor(() => expect(status()).toBe("Session ended (read-only)"));
  await waitFor(() =>
    expect(screen.getByTestId("whiteboard").textContent).toBe("r1,t1"),
  );
  expect(screen.getByTestId("whiteboard").dataset.readOnly).toBe("true");
});

it("marks the connected viewer online in the color the server assigns", async () => {
  api();
  const { connect, opened } = fakeConnect();
  view("bob", connect);
  await waitFor(() => expect(connect).toHaveBeenCalled());
  act(() => opened.options!.onSynced());
  act(() =>
    opened.options!.onStateless(
      JSON.stringify({
        type: "presence",
        user: { userId: "bob", name: "Bob", color: "#1d4ed8" },
      }),
    ),
  );
  const bob = screen.getByText(/Bob \(you\)/).closest("li")!;
  expect(bob.textContent).toContain(", online");
  const avatar = bob.querySelector(".session-avatar") as HTMLElement;
  expect(avatar.textContent?.startsWith("B")).toBe(true);
  expect(avatar.style.background).toBe("rgb(29, 78, 216)");
  expect(bob.querySelector(".presence-dot.online")).not.toBeNull();
});

it("keeps each tab's actions in the tab bar and copies the code", async () => {
  api();
  const writeText = vi.fn(async () => undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  const { connect, opened } = fakeConnect();
  view("alice", connect);
  await waitFor(() => expect(connect).toHaveBeenCalled());
  act(() => opened.options!.onSynced());
  act(() => opened.options!.document.getText("content").insert(0, "x = 1"));
  const copy = screen.getByRole("button", { name: "Copy code" });
  expect(screen.getByLabelText("Language")).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "End session" }).closest("header"),
  ).not.toBeNull();
  await userEvent.click(copy);
  expect(writeText).toHaveBeenCalledWith("x = 1");
  expect(await screen.findByText("Code copied to the clipboard")).toBeTruthy();
  await userEvent.click(screen.getByRole("tab", { name: "Whiteboard" }));
  expect(copy.closest(".session-tab-actions")?.hasAttribute("hidden")).toBe(
    true,
  );
  expect(screen.queryByText(/Live session ·/)).toBeNull();
});

it("invites a member as a viewer", async () => {
  const calls = api();
  const { connect } = fakeConnect();
  view("alice", connect);
  await userEvent.click(
    await screen.findByRole("button", { name: "+ Invite" }),
  );
  const picker = (await screen.findByLabelText(
    "Invite a course member",
  )) as HTMLSelectElement;
  await waitFor(() => expect(picker.disabled).toBe(false));
  await userEvent.selectOptions(picker, "tim");
  await userEvent.click(screen.getByRole("radio", { name: "Can view" }));
  await userEvent.click(screen.getByRole("button", { name: "Invite" }));
  await screen.findByText(/^Tim/);
  const invite = calls.find((call) => call.url.endsWith("/participants"))!;
  expect(JSON.parse(String(invite.init!.body))).toEqual({
    userId: "tim",
    permission: "view",
  });
});

it("keeps a viewer read-only and marks viewers in the participant list", async () => {
  api({
    ticketPermission: "read",
    session: {
      participants: [
        {
          userId: "alice",
          displayName: "Alice",
          role: "creator",
          permission: "edit",
        },
        {
          userId: "bob",
          displayName: "Bob",
          role: "invitee",
          permission: "view",
        },
      ],
    },
  });
  const { connect, opened } = fakeConnect();
  view("bob", connect);
  await waitFor(() => expect(connect).toHaveBeenCalled());
  act(() => opened.options!.onSynced());
  expect(await screen.findByText("View only")).toBeTruthy();
  expect(status()).toBe("Connected");
  expect(editor().getAttribute("contenteditable")).toBe("false");
  expect(screen.getByText(/Bob \(you\)/).closest("li")!.textContent).toContain(
    "Invited · Viewer",
  );
});

it("returns to Collaboration without post actions", async () => {
  api();
  const { connect } = fakeConnect();
  const onNavigate = view("bob", connect);
  const back = await screen.findByRole("link", {
    name: "Back to Collaboration",
  });
  expect(back.getAttribute("href")).toBe("/courses/c-1/collaboration");
  expect(
    screen.queryByRole("button", { name: "Post to discussion" }),
  ).toBeNull();
  await userEvent.click(back);
  expect(onNavigate).toHaveBeenCalledWith("/courses/c-1/collaboration");
});

it("warns that a legacy ended session shows its last saved snapshot", async () => {
  api({
    session: { status: "ended", finalSnapshotConfirmed: false },
    snapshot: "last saved",
    lastSavedWarning: true,
  });
  const { connect } = fakeConnect();
  view("bob", connect);
  expect(await screen.findByText(/Recent edits may be missing/)).toBeTruthy();
  expect(connect).not.toHaveBeenCalled();
});

it("keeps local edits unconfirmed until a failed final snapshot is retried", async () => {
  const calls = api({
    snapshot: "last saved code",
    lastSavedWarning: true,
    snapshotFailures: 1,
  });
  const { connect, opened } = fakeConnect();
  view("bob", connect);
  await waitFor(() => expect(connect).toHaveBeenCalled());
  act(() => {
    opened.options!.document.getText("content").insert(0, "local unsaved code");
    opened.options!.onSynced();
    opened.options!.onClose("session-ended");
  });
  expect(await screen.findByText(/Saved snapshot unavailable/)).toBeTruthy();
  expect(editor().textContent).toContain("local unsaved code");
  expect(screen.queryByText(/^This shows the last saved version/)).toBeNull();
  await userEvent.click(
    screen.getByRole("button", { name: "Retry loading saved snapshot" }),
  );
  await waitFor(() =>
    expect(editor().textContent).toContain("last saved code"),
  );
  expect(editor().textContent).not.toContain("local unsaved code");
  expect(
    await screen.findByText(/This shows the last saved version/),
  ).toBeTruthy();
  expect(calls.filter((call) => call.url.endsWith("/snapshot"))).toHaveLength(
    2,
  );
});
