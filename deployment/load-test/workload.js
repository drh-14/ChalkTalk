/* global open, __ENV, __VU */
import http from "k6/http";
import { check, sleep } from "k6";
import exec from "k6/execution";
import { Counter, Rate } from "k6/metrics";

const WRITE_INTERVAL_MS = 30000;
const BASE_URL = "https://joinchalktalk.com";
const manifest = JSON.parse(open(__ENV.MANIFEST_PATH));
const profile = JSON.parse(open(__ENV.PROFILE_PATH));
if (
  !Number.isInteger(profile.maxVus) ||
  profile.maxVus < 1 ||
  profile.maxVus > 20 ||
  !Array.isArray(profile.stageMinutes) ||
  profile.stageMinutes.length !== 4 ||
  profile.stageMinutes.some((n) => !Number.isInteger(n) || n < 1) ||
  profile.stageMinutes.reduce((a, b) => a + b, 0) > 10 ||
  !Array.isArray(profile.stageTargets) ||
  JSON.stringify(profile.stageTargets) !==
    JSON.stringify([1, 5, 10, 20].map((n) => Math.min(n, profile.maxVus))) ||
  !Number.isInteger(profile.rampWriteAttempts) ||
  profile.rampWriteAttempts < 6 ||
  profile.rampWriteAttempts > 17
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
if (
  !Array.isArray(manifest.users) ||
  manifest.users.length !== 20 ||
  new Set(manifest.users.map((u) => u.email)).size !== 20
)
  throw new Error("Expected 20 distinct synthetic users");
if (!["smoke", "ramp"].includes(mode))
  throw new Error("MODE must be smoke or ramp");

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
  ].map((name) => [name, new Counter(`op_${name}_success`)]),
);

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
      : {
          traffic: {
            executor: "ramping-vus",
            startVUs: 1,
            stages: [
              {
                duration: `${profile.stageMinutes[0]}m`,
                target: profile.stageTargets[0],
              },
              {
                duration: `${profile.stageMinutes[1]}m`,
                target: profile.stageTargets[1],
              },
              {
                duration: `${profile.stageMinutes[2]}m`,
                target: profile.stageTargets[2],
              },
              {
                duration: `${profile.stageMinutes[3]}m`,
                target: profile.stageTargets[3],
              },
            ],
            gracefulRampDown: "0s",
          },
        },
  thresholds: {
    unexpected_errors: [
      { threshold: "rate<0.02", abortOnFail: true, delayAbortEval: "1m" },
    ],
    rate_limit_hits: [{ threshold: "count<1", abortOnFail: true }],
  },
};

let session;
let writes = 0;
let lastWriteAt = 0;
let activeQuestionId = manifest.questionId;
let activePollId = manifest.pollId;
let activeOptionId = manifest.pollOptionId;

function request(method, path, body, name, expected, csrf) {
  const headers = { Accept: "application/json" };
  // k6 clears its cookie jar between iterations; keep the authenticated VU session.
  if (session) headers.Cookie = session.cookie;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET") {
    headers.Origin = BASE_URL;
    if (csrf) headers["X-CSRF-Token"] = csrf;
  }
  let response;
  try {
    response = http.request(
      method,
      `${BASE_URL}${path}`,
      body === undefined ? null : JSON.stringify(body),
      {
        headers,
        tags: { name },
        timeout: "10s",
      },
    );
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

function login() {
  const user = manifest.users[__VU - 1];
  if (!user) throw new Error("VU exceeds synthetic account count");
  const response = request(
    "POST",
    "/api/v1/sessions",
    { email: user.email, password: user.password },
    "login",
    201,
  );
  const csrf = response.json("data.csrfToken");
  if (typeof csrf !== "string" || !csrf)
    throw new Error("Login response lacks CSRF token");
  const cookie = response.cookies["__Host-chalktalk_session"]?.[0]?.value;
  if (typeof cookie !== "string" || !cookie)
    throw new Error("Login response lacks session cookie");
  session = { csrf, cookie: `__Host-chalktalk_session=${cookie}` };
}

const mutationKinds = [
  "question",
  "note",
  "answer",
  "followup",
  "poll",
  "vote",
];
function mutate() {
  if (
    __VU !== 1 ||
    writes >= (mode === "smoke" ? 1 : profile.rampWriteAttempts)
  )
    return;
  const now = Date.now();
  if (lastWriteAt && now - lastWriteAt < WRITE_INTERVAL_MS) return;
  const attempt = writes;
  writes += 1;
  lastWriteAt = now;
  if (mode === "smoke") {
    request(
      "PUT",
      `/api/v1/posts/${manifest.pollId}/vote`,
      { optionId: manifest.pollOptionId },
      "smoke_vote",
      200,
      session.csrf,
    );
    return;
  }
  const kind = mutationKinds[attempt % mutationKinds.length];
  const round = Math.floor(attempt / mutationKinds.length) + 1;
  const label = `Load test ${manifest.runId} ${round}`;
  const csrf = session.csrf;
  if (kind === "question") {
    const response = request(
      "POST",
      `/api/v1/courses/${manifest.courseId}/posts`,
      {
        type: "question",
        title: `${label} question`,
        bodyMarkdown: "Synthetic question for bounded load testing",
      },
      "create_question",
      201,
      csrf,
    );
    activeQuestionId = mutationId(response, "data.id");
  } else if (kind === "note") {
    request(
      "POST",
      `/api/v1/courses/${manifest.courseId}/posts`,
      {
        type: "note",
        title: `${label} note`,
        bodyMarkdown: "Synthetic note for bounded load testing",
      },
      "create_note",
      201,
      csrf,
    );
  } else if (kind === "answer") {
    request(
      "POST",
      `/api/v1/posts/${activeQuestionId}/answers`,
      { bodyMarkdown: "Synthetic answer for bounded load testing" },
      "create_answer",
      201,
      csrf,
    );
  } else if (kind === "followup") {
    request(
      "POST",
      `/api/v1/posts/${activeQuestionId}/followups`,
      { bodyMarkdown: "Synthetic followup for bounded load testing" },
      "create_followup",
      201,
      csrf,
    );
  } else if (kind === "poll") {
    const response = request(
      "POST",
      `/api/v1/courses/${manifest.courseId}/posts`,
      {
        type: "poll",
        title: `${label} poll`,
        bodyMarkdown: "Synthetic poll for bounded load testing",
        options: [{ label: "Option A" }, { label: "Option B" }],
      },
      "create_poll",
      201,
      csrf,
    );
    activePollId = mutationId(response, "data.id");
    activeOptionId = mutationId(response, "data.options.0.id");
  } else {
    request(
      "PUT",
      `/api/v1/posts/${activePollId}/vote`,
      { optionId: activeOptionId },
      "vote",
      200,
      csrf,
    );
  }
}

export default function () {
  if (!session) login();
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
  mutate();
  sleep(2);
}

export function handleSummary(data) {
  return {
    [`${__ENV.REPORT_DIR}/${manifest.runId}-${mode}-summary.json`]:
      JSON.stringify(data, null, 2),
  };
}
