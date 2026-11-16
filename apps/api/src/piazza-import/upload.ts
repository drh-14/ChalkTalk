import { AuthError } from "../auth/errors.js";
import {
  isImportablePost,
  type PiazzaChild,
  type PiazzaExport,
  type PiazzaPost,
} from "./convert.js";

const MAX_POSTS = 10_000;
const MAX_USERS = 30_000;
const MAX_NODES = 100_000;
const MAX_DEPTH = 6;
const MAX_TEXT = 200_000;

const invalid = (): never => {
  throw new AuthError(
    422,
    "validation_failed",
    "This is not a supported ChalkTalk Piazza JSON export",
  );
};
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : invalid();
const string = (value: unknown, max = MAX_TEXT): string =>
  typeof value === "string" && value.length > 0 && value.length <= max
    ? value
    : invalid();
const optionalString = (value: unknown, max = MAX_TEXT) => {
  if (value !== undefined) string(value, max);
};
const optionalText = (value: unknown, max = MAX_TEXT) => {
  if (value !== undefined && (typeof value !== "string" || value.length > max))
    invalid();
};
const array = (value: unknown, max: number): unknown[] =>
  Array.isArray(value) && value.length <= max ? value : invalid();
const date = (value: unknown) => {
  const text = string(value, 64);
  const parts = /^(\d{4})-(\d{2})-(\d{2})T/.exec(text) ?? invalid();
  if (!Number.isFinite(Date.parse(text))) invalid();
  const year = Number(parts[1]);
  const month = Number(parts[2]);
  const day = Number(parts[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
    31,
    leap ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  if (year === 0 || day < 1 || day > (daysInMonth[month - 1] ?? 0)) invalid();
};
const optionalArray = (value: unknown, max: number) => {
  if (value !== undefined) array(value, max);
};

function history(value: unknown) {
  for (const entry of array(value, 100)) {
    const item = object(entry);
    date(item.created);
    optionalString(item.uid, 255);
    optionalString(item.anon, 255);
    optionalText(item.subject);
    optionalText(item.content);
  }
}

function children(value: unknown, depth: number, counter: { count: number }) {
  if (depth > MAX_DEPTH) invalid();
  for (const entry of array(value, MAX_NODES)) {
    if (++counter.count > MAX_NODES) invalid();
    const item = object(entry);
    string(item.id, 255);
    string(item.type, 50);
    date(item.created);
    if (item.updated !== undefined) date(item.updated);
    optionalString(item.uid, 255);
    optionalString(item.anon, 255);
    optionalText(item.subject);
    if (item.no_answer !== undefined && typeof item.no_answer !== "number")
      invalid();
    if (item.history !== undefined) history(item.history);
    for (const field of ["tag_endorse", "tag_good"] as const) {
      if (item[field] !== undefined) {
        for (const tag of array(item[field], MAX_USERS)) {
          const value = object(tag);
          string(value.id, 255);
          optionalString(value.role, 50);
        }
      }
    }
    if (item.children !== undefined)
      children(item.children, depth + 1, counter);
  }
}

function referencedUsers(posts: PiazzaPost[]): Set<string> {
  const ids = new Set<string>();
  const discussion = (node: PiazzaChild) => {
    if (node.uid) ids.add(node.uid);
    for (const tag of node.tag_good ?? []) ids.add(tag.id);
    if (node.type === "followup")
      for (const child of node.children ?? [])
        if (child.type === "feedback") discussion(child);
  };
  for (const post of posts) {
    for (const entry of post.history) if (entry.uid) ids.add(entry.uid);
    for (const child of post.children ?? []) {
      if (child.type === "i_answer" || child.type === "s_answer") {
        if (child.history?.length) {
          for (const entry of child.history) if (entry.uid) ids.add(entry.uid);
        } else if (child.uid) ids.add(child.uid);
        for (const tag of child.tag_endorse ?? []) ids.add(tag.id);
      } else if (child.type === "followup") discussion(child);
    }
  }
  return ids;
}

/** Validates consumed CLI export fields and excludes private-post content. */
export function parsePiazzaUpload(text: string): {
  data: PiazzaExport;
  omittedPrivatePosts: number;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    invalid();
  }
  const root = object(parsed);
  const network = object(root.network);
  string(network.id, 255);
  string(network.name, 200);
  optionalString(network.courseNumber, 100);
  optionalString(network.term, 100);
  if (root.selfUid !== null) string(root.selfUid, 255);
  const users = array(root.users, MAX_USERS);
  for (const entry of users) {
    const user = object(entry);
    string(user.id, 255);
    optionalText(user.name, 100);
    optionalString(user.role, 50);
  }
  const posts = array(root.posts, MAX_POSTS);
  const counter = { count: 0 };
  for (const entry of posts) {
    const post = object(entry);
    string(post.id, 255);
    string(post.type, 50);
    date(post.created);
    optionalString(post.status, 50);
    if (post.nr !== undefined && typeof post.nr !== "number") invalid();
    if (post.pinned !== undefined && typeof post.pinned !== "boolean")
      invalid();
    optionalArray(post.folders, 1000);
    for (const folder of (post.folders as unknown[] | undefined) ?? [])
      string(folder, 100);
    history(post.history);
    if (post.children !== undefined) children(post.children, 1, counter);
  }
  const source = root as PiazzaExport;
  const publicPosts = source.posts.filter((post) => post.status !== "private");
  const referenced = referencedUsers(publicPosts.filter(isImportablePost));
  if (source.selfUid) referenced.add(source.selfUid);
  const data: PiazzaExport = {
    ...source,
    users: source.users.filter((user) => referenced.has(user.id)),
    posts: publicPosts,
  };
  return {
    data,
    omittedPrivatePosts: source.posts.length - publicPosts.length,
  };
}
