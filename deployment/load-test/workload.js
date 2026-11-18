/* global open, __ENV, __VU, setTimeout */
import http from "k6/http";
import { check, sleep } from "k6";
import exec from "k6/execution";
import { Counter, Rate } from "k6/metrics";
import { WebSocket } from "k6/websockets";
import { SLOT_MS, buildRampSchedule, mayStartSlot } from "./schedule.mjs";

const BASE_URL = "https://joinchalktalk.com";
const manifest = JSON.parse(open(__ENV.MANIFEST_PATH));
const profile = JSON.parse(open(__ENV.PROFILE_PATH));
if (
  !Number.isInteger(profile.maxVus) ||
  profile.maxVus < 1 ||
  profile.maxVus > 30 ||
  !Array.isArray(profile.stageMinutes) ||
  profile.stageMinutes.length !== 4 ||
  profile.stageMinutes.some((n) => !Number.isInteger(n) || n < 1) ||
  profile.stageMinutes.reduce((a, b) => a + b, 0) > 10 ||
  !Array.isArray(profile.stageTargets) ||
  JSON.stringify(profile.stageTargets) !==
    JSON.stringify([2, 10, 20, 30].map((n) => Math.min(n, profile.maxVus))) ||
  !Number.isInteger(profile.rampWriteAttempts) ||
  profile.rampWriteAttempts !== (__ENV.MODE === "ramp" ? 60 : 17) ||
  JSON.stringify(profile.stageMinutes) !== JSON.stringify([1, 3, 3, 3]) ||
  (__ENV.MODE === "ramp" && profile.maxVus < 10) ||
  (__ENV.MODE === "smoke" && profile.maxVus !== 1)
)
  throw new Error("Invalid bounded load profile");
const mode = __ENV.MODE;

if (
  __ENV.CONFIRM_PRODUCTION !== "joinchalktalk.com" ||
  manifest.baseUrl !== BASE_URL
)
  throw new Error(
    "Explicit production confirmation and exact fixture target are required",
  );
if (
  !/^[a-z0-9][a-z0-9-]{7,63}$/.test(manifest.runId) ||
  __ENV.RUN_ID !== manifest.runId
)
  throw new Error("Run ID must match the credential manifest");
if (
  !/^[0-9a-f]{40}$/.test(manifest.deployedSha) ||
  __ENV.DEPLOYED_SHA !== manifest.deployedSha
)
  throw new Error("Deployed SHA must match the credential manifest");
if (!["smoke", "ramp"].includes(mode))
  throw new Error("MODE must be smoke or ramp");
if (
  !Array.isArray(manifest.users) ||
  manifest.users.length !== (mode === "ramp" ? 30 : 20) ||
  new Set(manifest.users.map((u) => u.email)).size !== manifest.users.length ||
  (mode === "ramp" &&
    (manifest.mode !== "ramp" ||
      manifest.courses?.length !== 3 ||
      manifest.users.some(
        (u, i) => u.courseId !== manifest.courses[i % 3]?.id,
      )))
)
  throw new Error("Synthetic fixture does not match selected workload");
const rampSchedule = mode === "ramp" ? buildRampSchedule(profile.maxVus) : null;

const unexpectedErrors = new Rate("unexpected_errors");
const rateLimitHits = new Counter("rate_limit_hits");
const successfulOperations = Object.fromEntries(
  [
    "login",
    "list_courses",
    "list_posts",
    "read_post",
    "list_notifications",
    "unread_count",
    "smoke_vote",
    "create_question",
    "create_note",
    "create_answer",
    "create_followup",
    "create_poll",
    "vote",
    "list_threads",
    "thread_unread_count",
    "list_conversations",
    "read_conversation",
    "list_thread_messages",
    "thread_catchup",
    "resource_list",
    "resource_search",
    "create_thread_conversation",
    "create_thread_reply",
    "thread_watch",
    "thread_read",
    "thread_socket_subscribed",
    "thread_socket_changed",
    "thread_socket_closed",
    "course_1_post",
    "course_2_post",
    "course_3_post",
    "course_1_thread",
    "course_2_thread",
    "course_3_thread",
  ].map((name) => [name, new Counter(`op_${name}_success`)]),
);
const skippedWriteSlots = new Counter("skipped_write_slots");

export const options = {
  tags: { testid: manifest.runId },
  systemTags: ["name", "method", "status", "scenario", "expected_response"],
  scenarios:
    mode === "smoke"
      ? {
          traffic: {
            executor: "constant-vus",
            vus: 1,
            duration: "2m",
            gracefulStop: "0s",
          },
        }
      : Object.fromEntries(
          rampSchedule.actors.map((actor) => [
            `actor_${String(actor.actorIndex + 1).padStart(2, "0")}`,
            {
              executor: "constant-vus",
              vus: 1,
              startTime: `${actor.loginSlot * rampSchedule.slotMs}ms`,
              duration: `${rampSchedule.slotMs * (100 - actor.loginSlot)}ms`,
              gracefulStop: "0s",
            },
          ]),
        ),
  thresholds: {
    unexpected_errors: [
      { threshold: "rate<0.02", abortOnFail: true, delayAbortEval: "1m" },
    ],
    rate_limit_hits: [{ threshold: "count<1", abortOnFail: true }],
  },
};

let session;
let writes = 0;
let readIteration = 0;
let writeCursor = 0;
let socketAttempted = false;
let selectedPostId;
let conversationId;
let otherConversationId;
let latestMessageId;

export function setup() {
  return { originMs: Date.now() + 2000 };
}

function request(
  method,
  path,
  body,
  name,
  expected,
  csrf,
  writeSlot,
  originMs,
) {
  const headers = { Accept: "application/json" };
  // k6 clears its cookie jar between iterations; keep the authenticated VU session.
  if (session) headers.Cookie = session.cookie;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET") {
    headers.Origin = BASE_URL;
    if (csrf) headers["X-CSRF-Token"] = csrf;
  }
  let response;
  const payload = body === undefined ? null : JSON.stringify(body);
  if (
    writeSlot !== undefined &&
    !mayStartSlot(Date.now(), originMs, writeSlot)
  ) {
    skippedWriteSlots.add(1, { operation: name });
    return null;
  }
  try {
    response = http.request(method, `${BASE_URL}${path}`, payload, {
      headers,
      tags: { name },
      timeout: "10s",
    });
  } catch (error) {
    exec.test.abort(`${name}: network failure; workload stopped`);
    throw error;
  }
  const ok = response.status === expected;
  check(response, { "expected API status": () => ok }, { operation: name });
  unexpectedErrors.add(!ok, { operation: name });
  if (response.status === 429) {
    rateLimitHits.add(1, { operation: name });
    exec.test.abort("Rate limit encountered; workload invalid");
  }
  if (!ok) {
    exec.test.abort(`${name}: unexpected status ${response.status}`);
    throw new Error(`${name}: unexpected status ${response.status}`);
  }
  successfulOperations[name].add(1);
  return response;
}

function mutationId(response, path) {
  let id;
  try {
    id = response.json(path);
  } catch (error) {
    exec.test.abort("Mutation response is invalid; workload stopped");
    throw error;
  }
  if (typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id)) {
    exec.test.abort("Mutation response lacks an ID; workload stopped");
    throw new Error("Mutation response lacks an ID");
  }
  return id;
}

function login(actorIndex = __VU - 1, writeSlot, originMs) {
  const user = manifest.users[actorIndex];
  if (!user) throw new Error("VU exceeds synthetic account count");
  const response = request(
    "POST",
    "/api/v1/sessions",
    { email: user.email, password: user.password },
    "login",
    201,
    undefined,
    writeSlot,
    originMs,
  );
  if (!response) exec.test.abort("Missed reserved login slot");
  const csrf = response.json("data.csrfToken");
  if (typeof csrf !== "string" || !csrf)
    throw new Error("Login response lacks CSRF token");
  const cookie = response.cookies["__Host-chalktalk_session"]?.[0]?.value;
  if (typeof cookie !== "string" || !cookie)
    throw new Error("Login response lacks session cookie");
  session = { csrf, cookie: `__Host-chalktalk_session=${cookie}` };
}

function smokeVote(originMs) {
  if (writes) return;
  writes = 1;
  waitForSlot(originMs, 1);
  request(
    "PUT",
    `/api/v1/posts/${manifest.pollId}/vote`,
    { optionId: manifest.pollOptionId },
    "smoke_vote",
    200,
    session.csrf,
    1,
    originMs,
  );
}

function rampActor() {
  const match = /^actor_(\d{2})$/.exec(exec.scenario.name);
  const index = match ? Number(match[1]) - 1 : -1;
  if (index < 0 || index >= rampSchedule.actors.length)
    throw new Error("Ramp actor scenario does not match bounded profile");
  return rampSchedule.actors[index];
}

function waitForSlot(originMs, slot) {
  const delay = originMs + slot * SLOT_MS - Date.now();
  if (delay > 0) sleep(delay / 1000);
  return mayStartSlot(Date.now(), originMs, slot);
}

function readJsonArray(response, operation) {
  const value = response.json("data");
  if (!Array.isArray(value)) {
    exec.test.abort(`${operation}: expected a bounded list`);
    throw new Error(`${operation}: invalid list`);
  }
  return value;
}

function prepareThreadWatch(course) {
  const path = `/api/v1/courses/${course.id}/threads/${course.boardId}/conversations`;
  const others = readJsonArray(
    request("GET", path, undefined, "list_conversations", 200),
    "list_conversations",
  );
  otherConversationId = others.find((item) => item.id !== conversationId)?.id;
  if (!otherConversationId) {
    exec.test.abort("Other synthetic conversation is unavailable for watch");
    throw new Error("Other synthetic conversation is unavailable");
  }
}

function rampWrite(task, originMs) {
  const course = manifest.courses[task.courseIndex];
  const csrf = session.csrf;
  const label = `Synthetic ${manifest.runId} ${task.kind}`;
  const postPath = `/api/v1/courses/${course.id}/posts`;
  const threadPath = `/api/v1/courses/${course.id}/threads/${course.boardId}/conversations`;
  let response;
  if (["question", "note", "poll"].includes(task.kind)) {
    const body = {
      type: task.kind,
      title: label,
      bodyMarkdown:
        "Synthetic course question, note, or poll for bounded load testing",
      ...(task.kind === "poll"
        ? { options: [{ label: "Option A" }, { label: "Option B" }] }
        : {}),
    };
    response = request(
      "POST",
      postPath,
      body,
      task.kind === "question"
        ? "create_question"
        : task.kind === "note"
          ? "create_note"
          : "create_poll",
      201,
      csrf,
      task.slot,
      originMs,
    );
    if (response)
      successfulOperations[`course_${task.courseIndex + 1}_post`].add(1);
  } else if (task.kind === "answer") {
    response = request(
      "POST",
      `/api/v1/posts/${course.questionId}/answers`,
      { bodyMarkdown: label },
      "create_answer",
      201,
      csrf,
      task.slot,
      originMs,
    );
  } else if (task.kind === "followup") {
    response = request(
      "POST",
      `/api/v1/posts/${course.questionId}/followups`,
      { bodyMarkdown: label },
      "create_followup",
      201,
      csrf,
      task.slot,
      originMs,
    );
  } else if (task.kind === "vote") {
    response = request(
      "PUT",
      `/api/v1/posts/${course.pollId}/vote`,
      { optionId: course.pollOptionId },
      "vote",
      200,
      csrf,
      task.slot,
      originMs,
    );
  } else if (task.kind === "conversation") {
    response = request(
      "POST",
      threadPath,
      { bodyMarkdown: label },
      "create_thread_conversation",
      201,
      csrf,
      task.slot,
      originMs,
    );
    if (response) {
      conversationId = mutationId(response, "data.id");
      latestMessageId = mutationId(response, "openingMessage.id");
      successfulOperations[`course_${task.courseIndex + 1}_thread`].add(1);
    }
  } else if (task.kind === "watch") {
    if (!otherConversationId) return;
    response = request(
      "PUT",
      `${threadPath}/${otherConversationId}/watch`,
      { noticesEnabled: true },
      "thread_watch",
      200,
      csrf,
      task.slot,
      originMs,
    );
  } else if (task.kind === "reply") {
    if (!conversationId) return;
    response = request(
      "POST",
      `${threadPath}/${conversationId}/messages`,
      { bodyMarkdown: label },
      "create_thread_reply",
      201,
      csrf,
      task.slot,
      originMs,
    );
    if (response) {
      latestMessageId = mutationId(response, "data.id");
      successfulOperations[`course_${task.courseIndex + 1}_thread`].add(1);
    }
  } else if (task.kind === "read") {
    if (!conversationId || !latestMessageId) return;
    response = request(
      "POST",
      `${threadPath}/${conversationId}/read`,
      { messageIds: [latestMessageId] },
      "thread_read",
      204,
      csrf,
      task.slot,
      originMs,
    );
  }
  return response;
}

function rampRead(actor) {
  const course = manifest.courses[actor.courseIndex];
  const root = `/api/v1/courses/${course.id}`;
  const thread = `${root}/threads/${course.boardId}`;
  const selected = readIteration++ % 13;
  if (selected === 0)
    request("GET", "/api/v1/courses", undefined, "list_courses", 200);
  else if (selected === 1) {
    const posts = readJsonArray(
      request("GET", `${root}/posts`, undefined, "list_posts", 200),
      "list_posts",
    );
    if (!posts.length || typeof posts[0].id !== "string")
      exec.test.abort("Synthetic course feed is unexpectedly empty");
    selectedPostId = posts[0].id;
  } else if (selected === 2)
    request(
      "GET",
      `/api/v1/posts/${selectedPostId ?? course.questionId}`,
      undefined,
      "read_post",
      200,
    );
  else if (selected === 3)
    request(
      "GET",
      "/api/v1/users/me/notifications/unread-count",
      undefined,
      "unread_count",
      200,
    );
  else if (selected === 4)
    request(
      "GET",
      "/api/v1/users/me/notifications",
      undefined,
      "list_notifications",
      200,
    );
  else if (selected === 5)
    request("GET", `${root}/threads`, undefined, "list_threads", 200);
  else if (selected === 6)
    request(
      "GET",
      `${root}/threads/unread-count`,
      undefined,
      "thread_unread_count",
      200,
    );
  else if (selected === 7) {
    const conversations = readJsonArray(
      request(
        "GET",
        `${thread}/conversations`,
        undefined,
        "list_conversations",
        200,
      ),
      "list_conversations",
    );
    if (!conversationId && conversations.length)
      otherConversationId = conversations[0].id;
  } else if (selected === 8 && (conversationId || otherConversationId))
    request(
      "GET",
      `${thread}/conversations/${conversationId ?? otherConversationId}`,
      undefined,
      "read_conversation",
      200,
    );
  else if (selected === 9 && (conversationId || otherConversationId))
    request(
      "GET",
      `${thread}/conversations/${conversationId ?? otherConversationId}/messages`,
      undefined,
      "list_thread_messages",
      200,
    );
  else if (selected === 10)
    request("GET", `${root}/resources`, undefined, "resource_list", 200);
  else if (selected === 11)
    request(
      "GET",
      `${root}/resources/search?q=guide&limit=10`,
      undefined,
      "resource_search",
      200,
    );
  else if (selected === 12)
    request(
      "GET",
      `${root}/threads/changes?limit=20`,
      undefined,
      "thread_catchup",
      200,
    );
  sleep(1 + ((actor.actorIndex + readIteration) % 3));
}

function subscribeToThread(actor) {
  socketAttempted = true;
  const course = manifest.courses[actor.courseIndex];
  const url = `${BASE_URL.replace(/^http/, "ws")}/api/v1/thread-events`;
  const socket = new WebSocket(url, null, {
    headers: { Cookie: session.cookie, Origin: BASE_URL },
    tags: { name: "thread_socket" },
  });
  socket.onopen = () =>
    socket.send(JSON.stringify({ type: "subscribe", courseId: course.id }));
  socket.onmessage = (event) => {
    let signal;
    try {
      signal = JSON.parse(event.data);
    } catch {
      exec.test.abort("Invalid Thread signal");
      return;
    }
    if (signal.type === "subscribed" && signal.courseId === course.id)
      successfulOperations.thread_socket_subscribed.add(1);
    else if (signal.type === "changed" && signal.courseId === course.id)
      successfulOperations.thread_socket_changed.add(1);
    else if (signal.type === "error")
      exec.test.abort("Thread signal subscription rejected");
  };
  socket.onerror = () => exec.test.abort("Thread signal connection failed");
  socket.onclose = () => successfulOperations.thread_socket_closed.add(1);
  setTimeout(() => socket.close(), 100000);
}

function runRamp(data) {
  const actor = rampActor();
  if (!session) {
    waitForSlot(data.originMs, actor.loginSlot);
    login(actor.actorIndex, actor.loginSlot, data.originMs);
    return;
  }
  if (actor.actorIndex >= 6 && actor.actorIndex <= 8 && !socketAttempted) {
    subscribeToThread(actor);
    return;
  }
  const tasks = rampSchedule.writes.filter(
    (item) => item.actorIndex === actor.actorIndex,
  );
  const next = tasks[writeCursor];
  if (next) {
    const due = data.originMs + next.slot * rampSchedule.slotMs;
    if (Date.now() >= due - Math.min(3000, rampSchedule.slotMs / 2)) {
      if (next.kind === "watch" && !otherConversationId)
        prepareThreadWatch(manifest.courses[next.courseIndex]);
      writeCursor++;
      waitForSlot(data.originMs, next.slot);
      rampWrite(next, data.originMs);
      return;
    }
  }
  rampRead(actor);
}

export default function (data) {
  if (mode === "ramp") {
    runRamp(data);
    return;
  }
  if (!session) {
    waitForSlot(data.originMs, 0);
    login(undefined, 0, data.originMs);
  }
  request("GET", "/api/v1/courses", undefined, "list_courses", 200);
  request(
    "GET",
    `/api/v1/courses/${manifest.courseId}/posts`,
    undefined,
    "list_posts",
    200,
  );
  request(
    "GET",
    `/api/v1/posts/${manifest.questionId}`,
    undefined,
    "read_post",
    200,
  );
  request(
    "GET",
    "/api/v1/users/me/notifications",
    undefined,
    "list_notifications",
    200,
  );
  request(
    "GET",
    "/api/v1/users/me/notifications/unread-count",
    undefined,
    "unread_count",
    200,
  );
  smokeVote(data.originMs);
  sleep(1 + (__VU % 3));
}

export function handleSummary(data) {
  return {
    [`${__ENV.REPORT_DIR}/${manifest.runId}-${mode}-summary.json`]:
      JSON.stringify(data, null, 2),
  };
}
