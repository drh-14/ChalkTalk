## Authentication

All browser requests originate from a deployment-configured HTTPS frontend origin. The frontend and API use same-site custom domains, such as `app.example.edu` and `api.example.edu`, so browser sessions retain `SameSite=Lax`. The API returns credentialed CORS headers only for an exact allowlist match, echoes that origin rather than `*`, sends `Vary: Origin`, and permits credentials. Every `POST`, `PUT`, `PATCH`, and `DELETE` request includes `Origin`; public account and session bootstrap operations validate the origin without requiring a session or CSRF token. Authenticated unsafe requests additionally send the session-bound `X-CSRF-Token`. A missing, null, or disallowed origin fails before request processing. Expiring or revoking a session also invalidates its CSRF token and every unused WebSocket connection ticket issued through it.

<a id="createAccountVerificationRequest"></a>

### **`POST /api/v1/account-verification-requests`**

Requests verification of an account email before account creation or a same-school email change. The server normalizes the email and enforces the deployment's allowed school-domain policy. For every request with an allowed domain, it returns the same `202 Accepted` response whether the address is new, already registered, or cannot receive mail. If delivery is appropriate, the email contains a deployment-configured HTTPS link to the web client; clients cannot supply a redirect destination. Its cryptographically random opaque verification token expires after 30 minutes, is single-use, and is stored only in hashed form. The latest request invalidates any earlier unused verification token for the same normalized email. Rate limits default to five requests per normalized email per hour and 100 requests per source IP per hour; deployments may configure both limits. A matching `Idempotency-Key` retry returns the original result, while reuse with a different request body returns `409 idempotency_key_reused`.

**Authentication:** None.

**Access:** Public.

**Request media:** `application/json`

#### Request headers

`Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.

`Origin` (required, string): Browser origin, which must exactly match a deployment-configured HTTPS frontend origin.

`Content-Type` (required): Selects one documented request media type.

`Idempotency-Key` (optional, string, 1–255 characters): Reuses the original result for matching retries; keys are retained for 24 hours. Reusing a key with a different request body fails.

#### Path parameters

None.

#### Query parameters

None.

#### Request body

##### `AccountVerificationRequest` (required)

`email` (string, required): Email address to verify before account creation or a same-school account email change.

#### Multipart parts

None.

**Success:** `202 Accepted`.

**Response media:** None.

#### Response headers

None specific to this operation.

#### Response body

None.

#### Example request

```bash
curl --request POST '/api/v1/account-verification-requests' \
    --header 'Accept: application/json' \
    --header 'Origin: https://app.example.edu' \
    --header 'Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000' \
    --header 'Content-Type: application/json' \
    --data '{"email":"ada@example.edu"}'
```

#### Example success response

```http
202 Accepted
```

#### Errors

##### `403 Forbidden`

`origin_not_allowed`: The Origin header is missing, null, or not an allowed HTTPS frontend origin.

##### `409 Conflict`

`idempotency_key_reused`: The idempotency key was already used with a different request body.

##### `422 Unprocessable Content`

`email_domain_not_allowed`: The normalized email domain is not allowed by this deployment.

##### `429 Too Many Requests`

`rate_limited`: The configured per-email or per-source-IP request limit was exceeded. The response includes `Retry-After`.

##### `500 Internal Server Error`

`internal_error`: The server could not complete the request.

##### `503 Service Unavailable`

`service_unavailable`: A required service is temporarily unavailable.

---

<a id="createAccount"></a>

### **`POST /api/v1/users`**

Creates an account from a verified email token. The server hashes the supplied opaque token to locate a valid, unexpired proof, derives the normalized verified email from that proof, and never accepts an email separately. It atomically creates the account, finds or creates the organization for the canonical school domain, assigns it directly through `users.organization_id`, and consumes the single-use proof. ChalkTalk has no organization-membership table. A failed transaction consumes nothing. The password is accepted only at this boundary and is never returned. A matching `Idempotency-Key` retry returns the original result, while reuse with a different request body returns `409 idempotency_key_reused`.

**Authentication:** None.

**Access:** Public.

**Request media:** `application/json`

#### Request headers

`Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.

`Origin` (required, string): Browser origin, which must exactly match a deployment-configured HTTPS frontend origin.

`Content-Type` (required): Selects one documented request media type.

`Idempotency-Key` (optional, string, 1–255 characters): Reuses the original result for matching retries; keys are retained for 24 hours. Reusing a key with a different request body fails.

#### Path parameters

None.

#### Query parameters

None.

#### Request body

##### `CreateAccountRequest` (required)

`verificationToken` (string, required): Single-use token proving control of the verified email address.

`password` (string, required): New account password.

`displayName` (string, required): Visible account name.

#### Multipart parts

None.

**Success:** `201 Created`.

**Response media:** `application/json`.

#### Response headers

`Location` (string): Relative URL of the created resource or deletion status resource.

`ETag` (string): Opaque revision token representing the created resource state; return it unchanged in a later `If-Match` request.

#### Response body

##### `data` (object, required): User profile details.

`data.id` (string, required): Opaque stable identifier.

`data.email` (string, required): Account email address.

`data.displayName` (string, required): Visible account name.

`data.createdAt` (string, required): UTC timestamp in ISO 8601 date-time format.

`data.updatedAt` (string, required): UTC timestamp in ISO 8601 date-time format.

`data.version` (integer, required): Revision number used to construct the resource ETag.

#### Example request

```bash
curl --request POST '/api/v1/users' \
    --header 'Accept: application/json' \
    --header 'Origin: https://app.example.edu' \
    --header 'Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000' \
    --header 'Content-Type: application/json' \
    --data '{"verificationToken":"opaque_email_verification_token","password":"correct horse battery staple","displayName":"Ada Lovelace"}'
```

#### Example success response

```json
{
  "data": {
    "id": "user_123",
    "email": "ada@example.edu",
    "displayName": "Ada Lovelace",
    "createdAt": "2026-09-20T14:30:00Z",
    "updatedAt": "2026-09-20T14:30:00Z",
    "version": 1
  }
}
```

#### Errors

##### `403 Forbidden`

`origin_not_allowed`: The Origin header is missing, null, or not an allowed HTTPS frontend origin.

##### `409 Conflict`

`email_in_use`: The email already belongs to an account.

`idempotency_key_reused`: The idempotency key was already used with a different request body.

`verification_token_used`: The verification token has already been consumed.

##### `422 Unprocessable Content`

`verification_token_invalid`: The verification token is invalid, expired, or superseded by a later request.

`weak_password`: The password or another field fails validation.

##### `429 Too Many Requests`

`rate_limited`: Too many account-creation attempts.

##### `500 Internal Server Error`

`internal_error`: The server could not complete the request.

##### `503 Service Unavailable`

`service_unavailable`: A required service is temporarily unavailable.

---

<a id="createSession"></a>

### **`POST /api/v1/sessions`**

Authenticates a user and creates a 30-day browser session. Success always sets `__Host-chalktalk_session` with `Path=/`, `Max-Age=2592000`, `Secure`, `HttpOnly`, and `SameSite=Lax`, without a `Domain` attribute. It also returns a non-null opaque CSRF token that remains stable for the session lifetime and is sent in `X-CSRF-Token` on authenticated unsafe requests. The response is never stored by clients or intermediaries.

**Authentication:** None.

**Access:** Public.

**Request media:** `application/json`

#### Request headers

`Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.

`Origin` (required, string): Browser origin, which must exactly match a deployment-configured HTTPS frontend origin.

`Content-Type` (required): Selects one documented request media type.

#### Path parameters

None.

#### Query parameters

None.

#### Request body

##### `CreateSessionRequest` (required)

`email` (string, required): Account email.

`password` (string, required): Account password.

#### Multipart parts

None.

**Success:** `201 Created`.

**Response media:** `application/json`.

#### Response headers

`Set-Cookie` (required): `__Host-chalktalk_session=<opaque-session>; Path=/; Max-Age=2592000; Secure; HttpOnly; SameSite=Lax`. The cookie has no `Domain` attribute.

`Cache-Control: no-store` (required): Prevents storage of the session and CSRF token response.

#### Response body

##### `data` (object, required): Authenticated session details.

`data.id` (string, required): Opaque stable identifier.

`data.user` (object, required): User profile details.

`data.expiresAt` (string, required): UTC timestamp in ISO 8601 date-time format.

`data.csrfToken` (string, required): Stable opaque token bound to the session and sent in `X-CSRF-Token` for authenticated unsafe requests.

#### Example request

```bash
curl --request POST '/api/v1/sessions' \
    --header 'Accept: application/json' \
    --header 'Origin: https://app.example.edu' \
    --header 'Content-Type: application/json' \
    --data '{"email":"ada@example.edu","password":"correct horse battery staple"}'
```

#### Example success response

```json
{
  "data": {
    "id": "session_123",
    "user": {
      "id": "user_123",
      "email": "ada@example.edu",
      "displayName": "Ada Lovelace",
      "createdAt": "2026-09-20T14:30:00Z",
      "updatedAt": "2026-09-20T14:30:00Z",
      "version": 3
    },
    "expiresAt": "2026-10-20T14:30:00Z",
    "csrfToken": "opaque_csrf_token"
  }
}
```

#### Errors

##### `403 Forbidden`

`origin_not_allowed`: The Origin header is missing, null, or not an allowed HTTPS frontend origin.

##### `401 Unauthorized`

`invalid_credentials`: The email or password is invalid.

##### `422 Unprocessable Content`

`validation_failed`: The email or password field is malformed.

##### `429 Too Many Requests`

`rate_limited`: Too many sign-in attempts.

##### `500 Internal Server Error`

`internal_error`: The server could not complete the request.

##### `503 Service Unavailable`

`service_unavailable`: A required service is temporarily unavailable.

---

<a id="getCurrentSession"></a>

### **`GET /api/v1/sessions/current`**

Retrieves the current browser session after a page load or reload. It returns the same stable CSRF token issued when the session was created; retrieval does not rotate the token or extend the session expiry. The response is never stored by clients or intermediaries.

**Authentication:** `Cookie: __Host-chalktalk_session=<opaque-session>`.

**Access:** Signed-in user.

**Request media:** None.

#### Request headers

`Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.

`Cookie` (required): Supplies the `__Host-chalktalk_session` opaque session credential.

#### Path parameters

None.

#### Query parameters

None.

#### Request body

None.

#### Multipart parts

None.

**Success:** `200 OK`.

**Response media:** `application/json`.

#### Response headers

`Cache-Control: no-store` (required): Prevents storage of the session and CSRF token response.

#### Response body

##### `data` (object, required): Current authenticated session details.

`data.id` (string, required): Opaque stable identifier.

`data.user` (object, required): User profile details.

`data.expiresAt` (string, required): UTC timestamp in ISO 8601 date-time format.

`data.csrfToken` (string, required): Stable opaque token bound to the session and sent in `X-CSRF-Token` for authenticated unsafe requests.

#### Example request

```bash
curl --request GET '/api/v1/sessions/current' \
    --header 'Accept: application/json' \
    --header 'Cookie: __Host-chalktalk_session=opaque_session'
```

#### Example success response

```json
{
  "data": {
    "id": "session_123",
    "user": {
      "id": "user_123",
      "email": "ada@example.edu",
      "displayName": "Ada Lovelace",
      "createdAt": "2026-09-20T14:30:00Z",
      "updatedAt": "2026-09-20T14:30:00Z",
      "version": 3
    },
    "expiresAt": "2026-10-20T14:30:00Z",
    "csrfToken": "opaque_csrf_token"
  }
}
```

#### Errors

##### `401 Unauthorized`

`authentication_required`: The session is missing, expired, or invalid.

##### `500 Internal Server Error`

`internal_error`: The server could not complete the request.

##### `503 Service Unavailable`

`service_unavailable`: A required service is temporarily unavailable.

---

<a id="deleteCurrentSession"></a>

### **`DELETE /api/v1/sessions/current`**

Ends the current authenticated session and invalidates its CSRF token and every unused WebSocket connection ticket issued through it. Success expires the browser cookie. Repeating the request after success receives `401 Unauthorized` and still leaves the expired cookie client-side.

**Authentication:** `Cookie: __Host-chalktalk_session=<opaque-session>`.

**Access:** Signed-in user.

**Request media:** None.

#### Request headers

`Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.

`Cookie` (required): Supplies the `__Host-chalktalk_session` opaque session credential.

`Origin` (required, string): Browser origin, which must exactly match a deployment-configured HTTPS frontend origin.

`X-CSRF-Token` (required, string): Stable opaque token bound to the current session.

#### Path parameters

None.

#### Query parameters

None.

#### Request body

None.

#### Multipart parts

None.

**Success:** `204 No Content`.

**Response media:** None.

#### Response headers

`Set-Cookie` (required): `__Host-chalktalk_session=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax`. The clearing cookie has no `Domain` attribute.

#### Response body

None.

#### Example request

```bash
curl --request DELETE '/api/v1/sessions/current' \
    --header 'Accept: application/json' \
    --header 'Origin: https://app.example.edu' \
    --header 'Cookie: __Host-chalktalk_session=opaque_session' \
    --header 'X-CSRF-Token: opaque_csrf_token'
```

#### Example success response

```http
204 No Content
Set-Cookie: __Host-chalktalk_session=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax
```

#### Errors

##### `403 Forbidden`

`csrf_validation_failed`: The request origin or CSRF token is missing, invalid, or does not match the session.

##### `401 Unauthorized`

`authentication_required`: The session is missing or invalid.

##### `500 Internal Server Error`

`internal_error`: The server could not complete the request.

##### `503 Service Unavailable`

`service_unavailable`: A required service is temporarily unavailable.

---

<a id="getCurrentUser"></a>

### **`GET /api/v1/users/me`**

Retrieves the authenticated user’s account profile.

**Authentication:** `Cookie: __Host-chalktalk_session=<opaque-session>`.

**Access:** Signed-in user.

**Request media:** None.

#### Request headers

`Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.

`Cookie` (required): Supplies the `__Host-chalktalk_session` opaque session credential.

#### Path parameters

None.

#### Query parameters

None.

#### Request body

None.

#### Multipart parts

None.

**Success:** `200 OK`.

**Response media:** `application/json`.

#### Response headers

`ETag` (string): Opaque revision token for a later `If-Match` request.

#### Response body

##### `data` (object, required): User profile details.

`data.id` (string, required): Opaque stable identifier.

`data.email` (string, required): Account email address.

`data.displayName` (string, required): Visible account name.

`data.createdAt` (string, required): UTC timestamp in ISO 8601 date-time format.

`data.updatedAt` (string, required): UTC timestamp in ISO 8601 date-time format.

`data.version` (integer, required): Revision number used to construct the resource ETag.

#### Example request

```bash
curl --request GET '/api/v1/users/me' \
    --header 'Accept: application/json' \
    --header 'Cookie: __Host-chalktalk_session=opaque_session'
```

#### Example success response

```json
{
  "data": {
    "id": "user_123",
    "email": "ada@example.edu",
    "displayName": "Ada Lovelace",
    "createdAt": "2026-09-20T14:30:00Z",
    "updatedAt": "2026-09-20T14:30:00Z",
    "version": 3
  }
}
```

#### Errors

##### `401 Unauthorized`

`authentication_required`: Authentication is required.

##### `500 Internal Server Error`

`internal_error`: The server could not complete the request.

##### `503 Service Unavailable`

`service_unavailable`: A required service is temporarily unavailable.

---

<a id="updateCurrentUser"></a>

### **`PATCH /api/v1/users/me`**

Updates the authenticated user’s account profile. At least one field is required. When `emailVerificationToken` is supplied, the server hashes it to locate a valid, unexpired proof and derives the replacement email from that proof. The replacement email must have the same canonical school domain as the account's current email. The server updates the account and consumes the proof atomically; organization and course memberships do not change. A failed transaction consumes nothing.

**Authentication:** `Cookie: __Host-chalktalk_session=<opaque-session>`.

**Access:** Signed-in user.

**Request media:** `application/json`

#### Request headers

`Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.

`Cookie` (required): Supplies the `__Host-chalktalk_session` opaque session credential.

`Origin` (required, string): Browser origin, which must exactly match a deployment-configured HTTPS frontend origin.

`Content-Type` (required): Selects one documented request media type.

`If-Match` (required, string): Supplies the ETag from the latest retrieval.

`X-CSRF-Token` (required, string): Stable opaque token bound to the current session.

#### Path parameters

None.

#### Query parameters

None.

#### Request body

##### `UpdateUserRequest` (required)

`displayName` (string, optional): Replacement visible name.

`emailVerificationToken` (string, optional): Single-use token proving control of a replacement email address in the account's current school domain.

#### Multipart parts

None.

**Success:** `200 OK`.

**Response media:** `application/json`.

#### Response headers

`ETag` (string): Opaque revision token representing the returned resource state; return it unchanged in a later `If-Match` request.

#### Response body

##### `data` (object, required): User profile details.

`data.id` (string, required): Opaque stable identifier.

`data.email` (string, required): Account email address.

`data.displayName` (string, required): Visible account name.

`data.createdAt` (string, required): UTC timestamp in ISO 8601 date-time format.

`data.updatedAt` (string, required): UTC timestamp in ISO 8601 date-time format.

`data.version` (integer, required): Revision number used to construct the resource ETag.

#### Example request

```bash
curl --request PATCH '/api/v1/users/me' \
    --header 'Accept: application/json' \
    --header 'Origin: https://app.example.edu' \
    --header 'Cookie: __Host-chalktalk_session=opaque_session' \
    --header 'X-CSRF-Token: opaque_csrf_token' \
    --header 'If-Match: "v3"' \
    --header 'Content-Type: application/json' \
    --data '{"displayName":"Ada Byron","emailVerificationToken":"opaque_email_verification_token"}'
```

#### Example success response

```json
{
  "data": {
    "id": "user_123",
    "email": "ada.byron@example.edu",
    "displayName": "Ada Byron",
    "createdAt": "2026-09-20T14:30:00Z",
    "updatedAt": "2026-09-20T14:40:00Z",
    "version": 4
  }
}
```

#### Errors

##### `403 Forbidden`

`csrf_validation_failed`: The request origin or CSRF token is missing, invalid, or does not match the session.

##### `401 Unauthorized`

`authentication_required`: Authentication is required.

##### `409 Conflict`

`email_in_use`: The replacement email is already used.

`verification_token_used`: The email verification token has already been consumed.

##### `412 Precondition Failed`

`version_conflict`: The supplied ETag is stale.

##### `422 Unprocessable Content`

`email_domain_not_allowed`: The replacement email does not use the account's current canonical school domain.

`validation_failed`: No valid editable field was supplied.

`verification_token_invalid`: The email verification token is invalid, expired, or superseded by a later request.

##### `428 Precondition Required`

`precondition_required`: If-Match is required.

##### `500 Internal Server Error`

`internal_error`: The server could not complete the request.

##### `503 Service Unavailable`

`service_unavailable`: A required service is temporarily unavailable.

---

<a id="changeCurrentUserPassword"></a>

### **`PATCH /api/v1/users/me/password`**

Changes the authenticated user’s password. Success revokes the user’s other sessions together with their CSRF tokens and unused WebSocket connection tickets; the current session remains valid.

**Authentication:** `Cookie: __Host-chalktalk_session=<opaque-session>`.

**Access:** Signed-in user.

**Request media:** `application/json`

#### Request headers

`Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.

`Cookie` (required): Supplies the `__Host-chalktalk_session` opaque session credential.

`Origin` (required, string): Browser origin, which must exactly match a deployment-configured HTTPS frontend origin.

`Content-Type` (required): Selects one documented request media type.

`If-Match` (required, string): Supplies the ETag from the latest retrieval.

`X-CSRF-Token` (required, string): Stable opaque token bound to the current session.

#### Path parameters

None.

#### Query parameters

None.

#### Request body

##### `ChangePasswordRequest` (required)

`currentPassword` (string, required): Current password.

`newPassword` (string, required): Replacement password.

#### Multipart parts

None.

**Success:** `204 No Content`.

**Response media:** None.

#### Response headers

None specific to this operation.

#### Response body

None.

#### Example request

```bash
curl --request PATCH '/api/v1/users/me/password' \
    --header 'Accept: application/json' \
    --header 'Origin: https://app.example.edu' \
    --header 'Cookie: __Host-chalktalk_session=opaque_session' \
    --header 'X-CSRF-Token: opaque_csrf_token' \
    --header 'If-Match: "v3"' \
    --header 'Content-Type: application/json' \
    --data '{"currentPassword":"correct horse battery staple","newPassword":"a newer secure passphrase"}'
```

#### Example success response

```http
204 No Content
```

#### Errors

##### `403 Forbidden`

`csrf_validation_failed`: The request origin or CSRF token is missing, invalid, or does not match the session.

##### `401 Unauthorized`

`invalid_credentials`: The current password is invalid.

##### `412 Precondition Failed`

`version_conflict`: The supplied ETag is stale.

##### `422 Unprocessable Content`

`weak_password`: The replacement password does not meet the 12–128 character rule.

##### `428 Precondition Required`

`precondition_required`: If-Match is required.

##### `500 Internal Server Error`

`internal_error`: The server could not complete the request.

##### `503 Service Unavailable`

`service_unavailable`: A required service is temporarily unavailable.

---

<a id="createPasswordResetRequest"></a>

### **`POST /api/v1/password-reset-requests`**

Requests a password-reset email. Returns the same response whether or not the email exists, preventing account discovery.

**Authentication:** None.

**Access:** Public.

**Request media:** `application/json`

#### Request headers

`Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.

`Origin` (required, string): Browser origin, which must exactly match a deployment-configured HTTPS frontend origin.

`Content-Type` (required): Selects one documented request media type.

#### Path parameters

None.

#### Query parameters

None.

#### Request body

##### `PasswordResetRequest` (required)

`email` (string, required): Address that may receive reset mail.

#### Multipart parts

None.

**Success:** `202 Accepted`.

**Response media:** None.

#### Response headers

None specific to this operation.

#### Response body

None.

#### Example request

```bash
curl --request POST '/api/v1/password-reset-requests' \
    --header 'Accept: application/json' \
    --header 'Origin: https://app.example.edu' \
    --header 'Content-Type: application/json' \
    --data '{"email":"ada@example.edu"}'
```

#### Example success response

```http
202 Accepted
```

#### Errors

##### `403 Forbidden`

`origin_not_allowed`: The Origin header is missing, null, or not an allowed HTTPS frontend origin.

##### `400 Bad Request`

`invalid_request`: The request is malformed.

##### `429 Too Many Requests`

`rate_limited`: Too many reset attempts.

##### `500 Internal Server Error`

`internal_error`: The server could not complete the request.

##### `503 Service Unavailable`

`service_unavailable`: A required service is temporarily unavailable.

---

<a id="resetPassword"></a>

### **`POST /api/v1/password-resets`**

Resets an account password using a password-reset token. Success consumes the token and revokes every existing session for the account together with their CSRF tokens and unused WebSocket connection tickets.

**Authentication:** None.

**Access:** Public.

**Request media:** `application/json`

#### Request headers

`Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.

`Origin` (required, string): Browser origin, which must exactly match a deployment-configured HTTPS frontend origin.

`Content-Type` (required): Selects one documented request media type.

#### Path parameters

None.

#### Query parameters

None.

#### Request body

##### `ResetPasswordRequest` (required)

`token` (string, required): One-time reset token from email.

`newPassword` (string, required): Replacement password.

#### Multipart parts

None.

**Success:** `204 No Content`.

**Response media:** None.

#### Response headers

None specific to this operation.

#### Response body

None.

#### Example request

```bash
curl --request POST '/api/v1/password-resets' \
    --header 'Accept: application/json' \
    --header 'Origin: https://app.example.edu' \
    --header 'Content-Type: application/json' \
    --data '{"token":"reset_token_value","newPassword":"a newer secure passphrase"}'
```

#### Example success response

```http
204 No Content
```

#### Errors

##### `403 Forbidden`

`origin_not_allowed`: The Origin header is missing, null, or not an allowed HTTPS frontend origin.

##### `409 Conflict`

`reset_token_used`: The one-time token was already consumed.

##### `422 Unprocessable Content`

`reset_token_invalid`: The token is invalid or expired, or the password fails validation.

##### `500 Internal Server Error`

`internal_error`: The server could not complete the request.

##### `503 Service Unavailable`

`service_unavailable`: A required service is temporarily unavailable.

---

<a id="deleteCurrentUser"></a>

### **`DELETE /api/v1/users/me`**

Deletes the authenticated user’s account after validating `currentPassword` against the authenticated user’s stored password hash. Retained contributions are pseudonymized; all sessions, their CSRF tokens, and their unused WebSocket connection tickets are revoked; and the current `__Host-chalktalk_session` cookie is expired. If deletion would remove the final instructor from a course, the server returns `409 Conflict` and leaves the account and current session intact.

**Authentication:** `Cookie: __Host-chalktalk_session=<opaque-session>`.

**Access:** Signed-in user.

**Request media:** `application/json`

#### Request headers

`Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.

`Cookie` (required): Supplies the `__Host-chalktalk_session` opaque session credential.

`Origin` (required, string): Browser origin, which must exactly match a deployment-configured HTTPS frontend origin.

`Content-Type` (required): Selects one documented request media type.

`If-Match` (required, string): Supplies the ETag from the latest retrieval.

`X-CSRF-Token` (required, string): Stable opaque token bound to the current session.

#### Path parameters

None.

#### Query parameters

None.

#### Request body

##### `DeleteAccountRequest` (required)

`currentPassword` (string, required): Current account password. Must contain 1 to 128 characters.

#### Multipart parts

None.

**Success:** `204 No Content`.

**Response media:** None.

#### Response headers

`Set-Cookie` (required): `__Host-chalktalk_session=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax`. The clearing cookie has no `Domain` attribute.

#### Response body

None.

#### Example request

```bash
curl --request DELETE '/api/v1/users/me' \
    --header 'Accept: application/json' \
    --header 'Origin: https://app.example.edu' \
    --header 'Cookie: __Host-chalktalk_session=opaque_session' \
    --header 'X-CSRF-Token: opaque_csrf_token' \
    --header 'If-Match: "v3"' \
    --header 'Content-Type: application/json' \
    --data '{"currentPassword":"correct horse battery staple"}'
```

#### Example success response

```http
204 No Content
```

#### Errors

##### `403 Forbidden`

`csrf_validation_failed`: The request origin or CSRF token is missing, invalid, or does not match the session.

##### `401 Unauthorized`

`invalid_credentials`: The supplied current password does not match the authenticated user’s password.

##### `409 Conflict`

`last_instructor`: Deletion would remove the final instructor from a course; the account and current session remain intact.

##### `412 Precondition Failed`

`version_conflict`: The supplied ETag is stale.

##### `428 Precondition Required`

`precondition_required`: If-Match is required.

##### `500 Internal Server Error`

`internal_error`: The server could not complete the request.

##### `503 Service Unavailable`

`service_unavailable`: A required service is temporarily unavailable.
