import argon2 from "argon2";
import type { Pool, PoolClient } from "pg";
import { v7 as uuidv7 } from "uuid";
import type { Environment } from "../config/environment.js";
import {
  hashOpaqueToken,
  isValidPassword,
  newOpaqueToken,
  tokensMatch,
} from "./crypto.js";
import { AuthError } from "./errors.js";

export interface EmailSender {
  send(
    message: { to: string; subject: string; text: string },
    options?: { signal?: AbortSignal },
  ): Promise<void>;
}

export interface PasswordResetTiming {
  now(): number;
  sleep(milliseconds: number): Promise<void>;
}

const systemPasswordResetTiming: PasswordResetTiming = {
  now: () => Date.now(),
  sleep: (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
};

export interface UserProfile {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface AuthenticatedSession {
  id: string;
  user: UserProfile;
  expiresAt: string;
  csrfToken: string;
}

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
  created_at: Date;
  updated_at: Date;
  version: number;
}

interface SessionRow extends UserRow {
  session_id: string;
  expires_at: Date;
  csrf_token_hash: Buffer;
}

interface CreateUserInput {
  verificationToken: unknown;
  password: unknown;
  displayName: unknown;
}

interface PreparedUserCreation {
  verificationToken: string;
  passwordHash: string;
  displayName: string;
}

export function normalizeEmail(value: unknown): string {
  if (typeof value !== "string")
    throw new AuthError(422, "validation_failed", "Email is required");
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AuthError(422, "validation_failed", "Email is invalid");
  }
  return email;
}

function domainFor(email: string): string {
  return email.slice(email.lastIndexOf("@") + 1);
}

function mapUser(row: UserRow): UserProfile {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    version: row.version,
  };
}

export function userEtag(user: UserProfile): string {
  return `"v${user.version}"`;
}

export class AuthService {
  constructor(
    private readonly pool: Pool,
    private readonly environment: Environment,
    private readonly emailSender: EmailSender,
    private readonly passwordResetTiming: PasswordResetTiming = systemPasswordResetTiming,
  ) {}

  private hash(token: string): Buffer {
    return hashOpaqueToken(token, this.environment.authTokenSecret);
  }

  private csrfToken(sessionCredential: string): string {
    return hashOpaqueToken(
      `csrf:${sessionCredential}`,
      this.environment.authTokenSecret,
    ).toString("base64url");
  }

  private async limit(
    queryable: Pool | PoolClient,
    action: string,
    subject: string,
    limit: number,
    windowSeconds: number,
  ): Promise<void> {
    const windowStartedAt = new Date(
      Math.floor(Date.now() / (windowSeconds * 1000)) * windowSeconds * 1000,
    );
    const key = `${action}:${this.hash(subject).toString("base64url")}:${windowStartedAt.toISOString()}`;
    const result = await queryable.query<{ request_count: number }>(
      `INSERT INTO rate_limit_buckets (bucket_key, window_started_at, request_count)
       VALUES ($1, $2, 1)
       ON CONFLICT (bucket_key) DO UPDATE SET request_count = rate_limit_buckets.request_count + 1, updated_at = now()
       RETURNING request_count`,
      [key, windowStartedAt],
    );
    if (result.rows[0]!.request_count > limit) {
      const retryAfter = Math.max(
        1,
        Math.ceil(
          (windowStartedAt.getTime() + windowSeconds * 1000 - Date.now()) /
            1000,
        ),
      );
      const error = new AuthError(429, "rate_limited", "Too many requests");
      Object.assign(error, { retryAfter });
      throw error;
    }
  }

  async checkLimit(
    email: string | undefined,
    ip: string,
    kind: "verification" | "login" | "reset" | "signup",
    queryable: Pool | PoolClient = this.pool,
  ): Promise<void> {
    const limits = this.environment.rateLimits;
    const emailLimit =
      kind === "verification"
        ? limits.verificationPerEmail
        : kind === "login"
          ? limits.loginPerEmail
          : limits.resetPerEmail;
    const ipLimit =
      kind === "verification"
        ? limits.verificationPerIp
        : kind === "login"
          ? limits.loginPerIp
          : kind === "reset"
            ? limits.resetPerIp
            : limits.signupPerIp;
    const duration = kind === "login" ? 15 * 60 : 60 * 60;
    if (email && kind !== "signup")
      await this.limit(queryable, `${kind}:email`, email, emailLimit, duration);
    await this.limit(queryable, `${kind}:ip`, ip, ipLimit, duration);
  }

  async getIdempotentResponse(
    scope: string,
    key: string | undefined,
    body: unknown,
  ): Promise<{ status: number; body: unknown } | undefined> {
    if (!key) return undefined;
    if (key.length > 255)
      throw new AuthError(
        422,
        "validation_failed",
        "Idempotency-Key is too long",
      );
    const requestHash = this.hash(JSON.stringify(body));
    const result = await this.pool.query<{
      request_hash: Buffer;
      status_code: number;
      response_body: unknown;
    }>(
      "SELECT request_hash, status_code, response_body FROM idempotency_records WHERE scope = $1 AND key = $2 AND expires_at > now()",
      [scope, key],
    );
    const existing = result.rows[0];
    if (!existing) return undefined;
    if (!existing.request_hash.equals(requestHash)) {
      throw new AuthError(
        409,
        "idempotency_key_reused",
        "Idempotency key was used with a different request",
      );
    }
    return { status: existing.status_code, body: existing.response_body };
  }

  async saveIdempotentResponse(
    scope: string,
    key: string | undefined,
    body: unknown,
    status: number,
    responseBody: unknown,
  ): Promise<void> {
    if (!key) return;
    await this.pool.query(
      "INSERT INTO idempotency_records (id, scope, key, request_hash, status_code, response_body, expires_at) VALUES ($1, $2, $3, $4, $5, $6, now() + interval '24 hours') ON CONFLICT (scope, key) DO NOTHING",
      [
        uuidv7(),
        scope,
        key,
        this.hash(JSON.stringify(body)),
        status,
        responseBody,
      ],
    );
  }

  private async transaction<T>(
    work: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async requestVerificationForEmail(
    email: string,
    client?: PoolClient,
  ): Promise<void> {
    const token = newOpaqueToken();
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    const persist = async (transactionClient: PoolClient) => {
      await transactionClient.query(
        "UPDATE email_verification_tokens SET superseded_at = now() WHERE email = $1 AND consumed_at IS NULL AND superseded_at IS NULL",
        [email],
      );
      await transactionClient.query(
        "INSERT INTO email_verification_tokens (id, email, token_hash, expires_at) VALUES ($1, $2, $3, $4)",
        [uuidv7(), email, this.hash(token), expiresAt],
      );
    };
    if (client) await persist(client);
    else await this.transaction(persist);
    await this.emailSender.send({
      to: email,
      subject: "Verify your ChalkTalk email",
      text: `Verify your account at ${this.environment.frontendBaseUrl}/verify-email?token=${encodeURIComponent(token)}`,
    });
  }

  async requestVerification(emailInput: unknown): Promise<void> {
    const email = normalizeEmail(emailInput);
    if (!this.environment.allowedSchoolDomains.has(domainFor(email)))
      throw new AuthError(
        422,
        "email_domain_not_allowed",
        "Email domain is not allowed",
      );
    await this.requestVerificationForEmail(email);
  }

  async requestVerificationIdempotently(
    key: string | undefined,
    requestBody: unknown,
    normalizedEmail: string,
    ip: string,
  ): Promise<void> {
    if (!this.environment.allowedSchoolDomains.has(domainFor(normalizedEmail)))
      throw new AuthError(
        422,
        "email_domain_not_allowed",
        "Email domain is not allowed",
      );
    if (!key) {
      await this.checkLimit(normalizedEmail, ip, "verification");
      await this.requestVerificationForEmail(normalizedEmail);
      return;
    }
    if (key.length > 255)
      throw new AuthError(
        422,
        "validation_failed",
        "Idempotency-Key is too long",
      );
    const requestHash = this.hash(JSON.stringify(requestBody));
    await this.transaction(async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))",
        ["verification", key],
      );
      const existing = await client.query<{
        request_hash: Buffer;
      }>(
        "SELECT request_hash FROM idempotency_records WHERE scope = $1 AND key = $2 AND expires_at > now()",
        ["verification", key],
      );
      const record = existing.rows[0];
      if (record) {
        if (!record.request_hash.equals(requestHash))
          throw new AuthError(
            409,
            "idempotency_key_reused",
            "Idempotency key was used with a different request",
          );
        return;
      }
      await this.checkLimit(normalizedEmail, ip, "verification", client);
      await this.requestVerificationForEmail(normalizedEmail, client);
      await client.query(
        "INSERT INTO idempotency_records (id, scope, key, request_hash, status_code, response_body, expires_at) VALUES ($1, $2, $3, $4, $5, $6, now() + interval '24 hours')",
        [uuidv7(), "verification", key, requestHash, 202, null],
      );
    });
  }

  private async prepareUserCreation(
    input: CreateUserInput,
  ): Promise<PreparedUserCreation> {
    if (typeof input.verificationToken !== "string")
      throw new AuthError(
        422,
        "verification_token_invalid",
        "Verification token is invalid",
      );
    if (!isValidPassword(input.password))
      throw new AuthError(
        422,
        "weak_password",
        "Password must be 12 to 128 characters",
      );
    if (
      typeof input.displayName !== "string" ||
      !input.displayName.trim() ||
      input.displayName.trim().length > 100
    ) {
      throw new AuthError(422, "validation_failed", "Display name is required");
    }
    const verificationToken = input.verificationToken;
    const displayName = input.displayName.trim();
    const passwordHash = await argon2.hash(input.password, {
      type: argon2.argon2id,
    });
    return { verificationToken, passwordHash, displayName };
  }

  private async createUserInTransaction(
    client: PoolClient,
    input: PreparedUserCreation,
  ): Promise<UserProfile> {
    const { verificationToken, passwordHash, displayName } = input;
    const verification = await client.query<{
      email: string;
      consumed_at: Date | null;
      superseded_at: Date | null;
      expires_at: Date;
    }>(
      `SELECT email, consumed_at, superseded_at, expires_at FROM email_verification_tokens
          WHERE token_hash = $1
          FOR UPDATE`,
      [this.hash(verificationToken)],
    );
    const proof = verification.rows[0];
    if (!proof)
      throw new AuthError(
        422,
        "verification_token_invalid",
        "Verification token is invalid",
      );
    if (proof.consumed_at)
      throw new AuthError(
        409,
        "verification_token_used",
        "Verification token has already been consumed",
      );
    if (proof.superseded_at || proof.expires_at <= new Date())
      throw new AuthError(
        422,
        "verification_token_invalid",
        "Verification token is invalid",
      );
    const domain = domainFor(proof.email);
    const organization = await client.query<{ id: string }>(
      `INSERT INTO organizations (id, domain, name) VALUES ($1, $2, $2)
         ON CONFLICT (domain) DO UPDATE SET domain = EXCLUDED.domain RETURNING id`,
      [uuidv7(), domain],
    );
    try {
      const userResult = await client.query<UserRow>(
        `INSERT INTO users (id, organization_id, email, display_name, password_hash)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, email, display_name, password_hash, created_at, updated_at, version`,
        [
          uuidv7(),
          organization.rows[0]!.id,
          proof.email,
          displayName,
          passwordHash,
        ],
      );
      await client.query(
        "UPDATE email_verification_tokens SET consumed_at = now() WHERE token_hash = $1",
        [this.hash(verificationToken)],
      );
      return mapUser(userResult.rows[0]!);
    } catch (error: unknown) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "23505"
      ) {
        throw new AuthError(
          409,
          "email_in_use",
          "Email already belongs to an account",
        );
      }
      throw error;
    }
  }

  async createUser(input: CreateUserInput): Promise<UserProfile> {
    const prepared = await this.prepareUserCreation(input);
    return this.transaction((client) =>
      this.createUserInTransaction(client, prepared),
    );
  }

  async createUserIdempotently(
    input: CreateUserInput,
    key: string | undefined,
    requestBody: unknown,
    ip: string,
  ): Promise<{ user: UserProfile; status: number }> {
    if (!key) {
      await this.checkLimit(undefined, ip, "signup");
      return { user: await this.createUser(input), status: 201 };
    }
    if (key.length > 255)
      throw new AuthError(
        422,
        "validation_failed",
        "Idempotency-Key is too long",
      );
    const requestHash = this.hash(JSON.stringify(requestBody));
    return this.transaction(async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))",
        ["user", key],
      );
      const existing = await client.query<{
        request_hash: Buffer;
        status_code: number;
        response_body: UserProfile;
      }>(
        "SELECT request_hash, status_code, response_body FROM idempotency_records WHERE scope = $1 AND key = $2 AND expires_at > now()",
        ["user", key],
      );
      const record = existing.rows[0];
      if (record) {
        if (!record.request_hash.equals(requestHash))
          throw new AuthError(
            409,
            "idempotency_key_reused",
            "Idempotency key was used with a different request",
          );
        return { user: record.response_body, status: record.status_code };
      }
      await this.checkLimit(undefined, ip, "signup", client);
      const user = await this.createUserInTransaction(
        client,
        await this.prepareUserCreation(input),
      );
      await client.query(
        "INSERT INTO idempotency_records (id, scope, key, request_hash, status_code, response_body, expires_at) VALUES ($1, $2, $3, $4, $5, $6, now() + interval '24 hours')",
        [uuidv7(), "user", key, requestHash, 201, user],
      );
      return { user, status: 201 };
    });
  }

  async login(
    emailInput: unknown,
    password: unknown,
  ): Promise<{ credential: string; session: AuthenticatedSession }> {
    const email = normalizeEmail(emailInput);
    if (typeof password !== "string")
      throw new AuthError(
        401,
        "invalid_credentials",
        "Email or password is invalid",
      );
    const userResult = await this.pool.query<UserRow>(
      `SELECT id, email, display_name, password_hash, created_at, updated_at, version
       FROM users WHERE email = $1 AND deleted_at IS NULL`,
      [email],
    );
    const user = userResult.rows[0];
    if (!user || !(await argon2.verify(user.password_hash, password))) {
      throw new AuthError(
        401,
        "invalid_credentials",
        "Email or password is invalid",
      );
    }
    const credential = newOpaqueToken();
    const csrfToken = this.csrfToken(credential);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const id = uuidv7();
    await this.pool.query(
      "INSERT INTO sessions (id, user_id, credential_hash, csrf_token_hash, expires_at) VALUES ($1, $2, $3, $4, $5)",
      [id, user.id, this.hash(credential), this.hash(csrfToken), expiresAt],
    );
    return {
      credential,
      session: {
        id,
        user: mapUser(user),
        expiresAt: expiresAt.toISOString(),
        csrfToken,
      },
    };
  }

  async session(
    credential: string,
    csrfToken?: string,
  ): Promise<AuthenticatedSession> {
    const result = await this.pool.query<SessionRow>(
      `SELECT s.id AS session_id, s.expires_at, s.csrf_token_hash,
              u.id, u.email, u.display_name, u.password_hash, u.created_at, u.updated_at, u.version
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.credential_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now() AND u.deleted_at IS NULL`,
      [this.hash(credential)],
    );
    const row = result.rows[0];
    if (!row)
      throw new AuthError(
        401,
        "authentication_required",
        "Authentication is required",
      );
    const expectedCsrf = this.csrfToken(credential);
    if (
      csrfToken !== undefined &&
      (!tokensMatch(
        csrfToken,
        row.csrf_token_hash,
        this.environment.authTokenSecret,
      ) ||
        csrfToken !== expectedCsrf)
    ) {
      throw new AuthError(
        403,
        "csrf_validation_failed",
        "CSRF token is invalid",
      );
    }
    return {
      id: row.session_id,
      user: mapUser(row),
      expiresAt: row.expires_at.toISOString(),
      csrfToken: expectedCsrf,
    };
  }

  async logout(sessionId: string): Promise<void> {
    await this.pool.query(
      "UPDATE sessions SET revoked_at = now() WHERE id = $1",
      [sessionId],
    );
  }

  async profile(sessionCredential: string): Promise<UserProfile> {
    return (await this.session(sessionCredential)).user;
  }

  async updateProfile(
    sessionCredential: string,
    ifMatch: string | undefined,
    input: { displayName?: unknown; emailVerificationToken?: unknown },
  ): Promise<UserProfile> {
    const session = await this.session(sessionCredential);
    if (!ifMatch)
      throw new AuthError(428, "precondition_required", "If-Match is required");
    if (ifMatch !== userEtag(session.user))
      throw new AuthError(412, "version_conflict", "Profile has changed");
    const displayName =
      input.displayName === undefined
        ? undefined
        : typeof input.displayName === "string" && input.displayName.trim()
          ? input.displayName.trim()
          : null;
    if (
      displayName === null ||
      (displayName === undefined && input.emailVerificationToken === undefined)
    )
      throw new AuthError(
        422,
        "validation_failed",
        "A profile field is required",
      );
    return this.transaction(async (client) => {
      let email = session.user.email;
      if (input.emailVerificationToken !== undefined) {
        if (typeof input.emailVerificationToken !== "string")
          throw new AuthError(
            422,
            "verification_token_invalid",
            "Verification token is invalid",
          );
        const verification = await client.query<{
          email: string;
          consumed_at: Date | null;
          superseded_at: Date | null;
          expires_at: Date;
        }>(
          "SELECT email, consumed_at, superseded_at, expires_at FROM email_verification_tokens WHERE token_hash = $1 FOR UPDATE",
          [this.hash(input.emailVerificationToken)],
        );
        const proof = verification.rows[0];
        if (!proof)
          throw new AuthError(
            422,
            "verification_token_invalid",
            "Verification token is invalid",
          );
        if (proof.consumed_at)
          throw new AuthError(
            409,
            "verification_token_used",
            "Verification token has already been consumed",
          );
        if (proof.superseded_at || proof.expires_at <= new Date())
          throw new AuthError(
            422,
            "verification_token_invalid",
            "Verification token is invalid",
          );
        if (domainFor(proof.email) !== domainFor(session.user.email))
          throw new AuthError(
            422,
            "email_domain_not_allowed",
            "Email must use the current school domain",
          );
        email = proof.email;
        await client.query(
          "UPDATE email_verification_tokens SET consumed_at = now() WHERE token_hash = $1",
          [this.hash(input.emailVerificationToken)],
        );
      }
      try {
        const updated = await client.query<UserRow>(
          `UPDATE users SET email = $1, display_name = COALESCE($2, display_name), version = version + 1, updated_at = now()
           WHERE id = $3 AND version = $4
           RETURNING id, email, display_name, password_hash, created_at, updated_at, version`,
          [email, displayName, session.user.id, session.user.version],
        );
        if (!updated.rows[0])
          throw new AuthError(412, "version_conflict", "Profile has changed");
        return mapUser(updated.rows[0]!);
      } catch (error: unknown) {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "23505"
        )
          throw new AuthError(
            409,
            "email_in_use",
            "Email already belongs to an account",
          );
        throw error;
      }
    });
  }

  async changePassword(
    sessionCredential: string,
    ifMatch: string | undefined,
    currentPassword: unknown,
    newPassword: unknown,
  ): Promise<void> {
    const session = await this.session(sessionCredential);
    if (!ifMatch)
      throw new AuthError(428, "precondition_required", "If-Match is required");
    if (ifMatch !== userEtag(session.user))
      throw new AuthError(412, "version_conflict", "Profile has changed");
    if (typeof currentPassword !== "string")
      throw new AuthError(
        401,
        "invalid_credentials",
        "Current password is invalid",
      );
    if (!isValidPassword(newPassword))
      throw new AuthError(422, "weak_password", "Password is invalid");
    const stored = await this.pool.query<{ password_hash: string }>(
      "SELECT password_hash FROM users WHERE id = $1",
      [session.user.id],
    );
    if (
      !stored.rows[0] ||
      !(await argon2.verify(stored.rows[0].password_hash, currentPassword))
    )
      throw new AuthError(
        401,
        "invalid_credentials",
        "Current password is invalid",
      );
    const passwordHash = await argon2.hash(newPassword, {
      type: argon2.argon2id,
    });
    await this.transaction(async (client) => {
      const updated = await client.query(
        "UPDATE users SET password_hash = $1, version = version + 1, updated_at = now() WHERE id = $2 AND version = $3 RETURNING id",
        [passwordHash, session.user.id, session.user.version],
      );
      if (!updated.rows[0])
        throw new AuthError(412, "version_conflict", "Profile has changed");
      await client.query(
        "UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL",
        [session.user.id, session.id],
      );
    });
  }

  async requestPasswordReset(emailInput: unknown): Promise<void> {
    const startedAt = this.passwordResetTiming.now();
    const email = normalizeEmail(emailInput);
    const found = await this.pool.query<{ id: string }>(
      "SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL",
      [email],
    );
    const user = found.rows[0];
    if (user) {
      const token = newOpaqueToken();
      await this.transaction(async (client) => {
        await client.query(
          "UPDATE password_reset_tokens SET consumed_at = now() WHERE user_id = $1 AND consumed_at IS NULL",
          [user.id],
        );
        await client.query(
          "INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, now() + interval '30 minutes')",
          [uuidv7(), user.id, this.hash(token)],
        );
      });
      const abortController = new AbortController();
      let deliveryFinished = false;
      const delivery = this.emailSender
        .send(
          {
            to: email,
            subject: "Reset your ChalkTalk password",
            text: `Reset your password at ${this.environment.frontendBaseUrl}/reset-password?token=${encodeURIComponent(token)}`,
          },
          { signal: abortController.signal },
        )
        .catch(() => undefined)
        .finally(() => {
          deliveryFinished = true;
        });
      await Promise.race([delivery, this.passwordResetTiming.sleep(750)]);
      if (!deliveryFinished) abortController.abort();
    }
    const remaining = 1000 - (this.passwordResetTiming.now() - startedAt);
    if (remaining > 0) await this.passwordResetTiming.sleep(remaining);
  }

  async resetPassword(token: unknown, newPassword: unknown): Promise<void> {
    if (typeof token !== "string" || !isValidPassword(newPassword))
      throw new AuthError(
        422,
        "reset_token_invalid",
        "Reset token or password is invalid",
      );
    const passwordHash = await argon2.hash(newPassword, {
      type: argon2.argon2id,
    });
    await this.transaction(async (client) => {
      const reset = await client.query<{
        user_id: string;
        consumed_at: Date | null;
        expires_at: Date;
      }>(
        "SELECT user_id, consumed_at, expires_at FROM password_reset_tokens WHERE token_hash = $1 FOR UPDATE",
        [this.hash(token)],
      );
      const record = reset.rows[0];
      if (!record)
        throw new AuthError(
          422,
          "reset_token_invalid",
          "Reset token is invalid",
        );
      if (record.consumed_at)
        throw new AuthError(
          409,
          "reset_token_used",
          "Reset token has already been consumed",
        );
      if (record.expires_at <= new Date())
        throw new AuthError(
          422,
          "reset_token_invalid",
          "Reset token is invalid",
        );
      await client.query(
        "UPDATE users SET password_hash = $1, version = version + 1, updated_at = now() WHERE id = $2",
        [passwordHash, record.user_id],
      );
      await client.query(
        "UPDATE password_reset_tokens SET consumed_at = now() WHERE token_hash = $1",
        [this.hash(token)],
      );
      await client.query(
        "UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL",
        [record.user_id],
      );
    });
  }

  async deleteAccount(
    sessionCredential: string,
    ifMatch: string | undefined,
    currentPassword: unknown,
  ): Promise<void> {
    const session = await this.session(sessionCredential);
    if (!ifMatch)
      throw new AuthError(428, "precondition_required", "If-Match is required");
    if (ifMatch !== userEtag(session.user))
      throw new AuthError(412, "version_conflict", "Profile has changed");
    if (typeof currentPassword !== "string")
      throw new AuthError(
        401,
        "invalid_credentials",
        "Current password is invalid",
      );
    await this.transaction(async (client) => {
      const user = await client.query<{ password_hash: string }>(
        "SELECT password_hash FROM users WHERE id = $1 AND version = $2 FOR UPDATE",
        [session.user.id, session.user.version],
      );
      if (!user.rows[0])
        throw new AuthError(412, "version_conflict", "Profile has changed");
      if (!(await argon2.verify(user.rows[0].password_hash, currentPassword)))
        throw new AuthError(
          401,
          "invalid_credentials",
          "Current password is invalid",
        );
      await client.query(
        `SELECT c.id FROM courses c JOIN course_memberships cm ON cm.course_id = c.id
         WHERE cm.user_id = $1 AND cm.role = 'instructor' FOR UPDATE`,
        [session.user.id],
      );
      const finalInstructor = await client.query(
        `SELECT 1 FROM course_memberships mine
         WHERE mine.user_id = $1 AND mine.role = 'instructor'
           AND NOT EXISTS (
             SELECT 1 FROM course_memberships other
             JOIN users other_user ON other_user.id = other.user_id
             WHERE other.course_id = mine.course_id
               AND other.role = 'instructor'
               AND other.user_id <> $1
               AND other_user.deleted_at IS NULL
           )
         LIMIT 1`,
        [session.user.id],
      );
      if (finalInstructor.rowCount)
        throw new AuthError(
          409,
          "last_instructor",
          "Account is the final instructor for a course",
        );
      const deleted = await client.query(
        "UPDATE users SET deleted_at = now(), email = concat('deleted+', id, '@invalid.local'), display_name = 'Deleted user', password_hash = '', version = version + 1, updated_at = now() WHERE id = $1 AND version = $2 RETURNING id",
        [session.user.id, session.user.version],
      );
      if (!deleted.rows[0])
        throw new AuthError(412, "version_conflict", "Profile has changed");
      await client.query("DELETE FROM course_memberships WHERE user_id = $1", [
        session.user.id,
      ]);
      await client.query(
        "UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL",
        [session.user.id],
      );
    });
  }
}
