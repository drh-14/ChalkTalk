import request from "supertest";
import { v7 as uuidv7 } from "uuid";
import { describe, expect, it, vi } from "vitest";
import type { AuthService } from "../auth/service.js";
import type { ThreadAttachmentService } from "../threads/attachments.js";
import { createApp } from "./app.js";

const userId = uuidv7();
const messageId = uuidv7();
const attachmentId = uuidv7();
const origin = "https://localhost:5173";
const environment = {
  databaseUrl: undefined,
  port: 3000,
  trustProxyHops: 0,
  frontendOrigins: new Set([origin]),
  frontendBaseUrl: origin,
  authTokenSecret: "test-secret-that-is-longer-than-thirty-two-characters",
  allowedSchoolDomains: new Set(["example.edu"]),
  rateLimits: {
    verificationPerEmail: 5,
    verificationPerIp: 100,
    loginPerEmail: 10,
    loginPerIp: 100,
    resetPerEmail: 5,
    resetPerIp: 100,
    signupPerIp: 100,
    collaborationCreatePerUser: 30,
    collaborationTicketPerUser: 300,
  },
  observability: { enabled: false },
  collaboration: {
    port: 3100,
    publicUrl: "wss://localhost:5173/collaboration",
    idleEndMinutes: 120,
  },
  smtp: {
    host: "localhost",
    port: 1025,
    secure: false,
    from: "test@example.edu",
  },
} as const;
const authService = {
  session: async () => ({
    id: uuidv7(),
    user: {
      id: userId,
      email: "u@example.edu",
      displayName: "User",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1,
    },
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    csrfToken: "csrf",
  }),
} as AuthService;
const attachment = {
  id: attachmentId,
  fileName: "notes.txt",
  mediaType: "text/plain",
  sizeBytes: 5,
  createdAt: new Date().toISOString(),
  downloadUrl: `/api/v1/thread-attachments/${attachmentId}/download`,
};

describe("thread attachment HTTP boundary", () => {
  it("uploads a file after a saved message and returns a downloadable attachment", async () => {
    const service = {
      authorizeUpload: vi.fn().mockResolvedValue(undefined),
      create: vi.fn().mockResolvedValue(attachment),
    } as unknown as ThreadAttachmentService;
    const app = createApp({
      environment: environment as never,
      authService,
      threadAttachmentService: service,
    });
    const response = await request(app)
      .post(`/api/v1/thread-messages/${messageId}/attachments`)
      .set("Cookie", "__Host-chalktalk_session=opaque")
      .set("Origin", origin)
      .set("X-CSRF-Token", "csrf")
      .set("Idempotency-Key", "upload-1")
      .attach("file", Buffer.from("hello"), {
        filename: "notes.txt",
        contentType: "text/plain",
      });
    expect(response.status).toBe(201);
    expect(response.body).toEqual({ data: attachment });
    expect(response.headers.location).toBe(attachment.downloadUrl);
    expect(
      (service as never as { create: ReturnType<typeof vi.fn> }).create,
    ).toHaveBeenCalled();
  });
});
