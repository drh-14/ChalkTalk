## Authentication

<a id="createAccountVerificationRequest"></a>
- **`POST /api/v1/account-verification-requests`**
  - Description: Requests verification of an account email before account creation or an email change. The server normalizes the email and enforces the deployment's allowed school-domain policy. For every request with an allowed domain, it returns the same `202 Accepted` response whether the address is new, already registered, or cannot receive mail. If delivery is appropriate, the email contains a deployment-configured universal link; clients cannot supply a redirect destination. Its cryptographically random opaque verification token expires after 30 minutes, is single-use, and is stored only in hashed form. The latest request invalidates any earlier unused verification token for the same normalized email. Rate limits default to five requests per normalized email per hour and 100 requests per source IP per hour; deployments may configure both limits. A matching `Idempotency-Key` retry returns the original result, while reuse with a different request body returns `409 idempotency_key_reused`.
  - Authentication: None.
  - Access: Public.
  - Request media: `application/json`
  - Request headers:
    - `Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.
    - `Content-Type` (required): Selects one documented request media type.
    - `Idempotency-Key` (optional, string, 1–255 characters): Reuses the original result for matching retries; keys are retained for 24 hours. Reusing a key with a different request body fails.
  - Path parameters:
    - None.
  - Query parameters:
    - None.
  - Request body:
    - Schema: `AccountVerificationRequest` (required).
    - `email` (string, required): Email address to verify before account creation or an account email change.
  - Multipart parts:
    - None.
  - Success: `202 Accepted`.
  - Response media: None.
  - Response headers:
    - None specific to this operation.
  - Response body:
    - None.
  - Example request:

    ```bash
    curl --request POST '/api/v1/account-verification-requests' \
        --header 'Accept: application/json' \
        --header 'Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000' \
        --header 'Content-Type: application/json' \
        --data '{"email":"ada@example.edu"}'
    ```

  - Example success response:

    ```http
    202 Accepted
    ```
  - Errors:
    - `409 Conflict`:
      - `idempotency_key_reused`: The idempotency key was already used with a different request body.
    - `422 Unprocessable Content`:
      - `email_domain_not_allowed`: The normalized email domain is not allowed by this deployment.
    - `429 Too Many Requests`:
      - `rate_limited`: The configured per-email or per-source-IP request limit was exceeded. The response includes `Retry-After`.
    - `500 Internal Server Error`:
      - `internal_error`: The server could not complete the request.
    - `503 Service Unavailable`:
      - `service_unavailable`: A required service is temporarily unavailable.

<a id="createAccount"></a>
- **`POST /api/v1/users`**
  - Description: Creates an account from a verified email token. The server hashes the supplied opaque token to locate a valid, unexpired proof, derives the normalized verified email from that proof, and never accepts an email separately. It atomically creates the account, finds or creates the organization for the canonical school domain, creates the organization membership, and consumes the single-use proof. A failed transaction consumes nothing. The password is accepted only at this boundary and is never returned. A matching `Idempotency-Key` retry returns the original result, while reuse with a different request body returns `409 idempotency_key_reused`.
  - Authentication: None.
  - Access: Public.
  - Request media: `application/json`
  - Request headers:
    - `Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.
    - `Content-Type` (required): Selects one documented request media type.
    - `Idempotency-Key` (optional, string, 1–255 characters): Reuses the original result for matching retries; keys are retained for 24 hours. Reusing a key with a different request body fails.
  - Path parameters:
    - None.
  - Query parameters:
    - None.
  - Request body:
    - Schema: `CreateAccountRequest` (required).
    - `verificationToken` (string, required): Single-use token proving control of the verified email address.
    - `password` (string, required): New account password.
    - `displayName` (string, required): Visible account name.
  - Multipart parts:
    - None.
  - Success: `201 Created`.
  - Response media: `application/json`.
  - Response headers:
    - `Location` (string): Relative URL of the created resource or deletion status resource.
  - Response body:
    - `data` (object, required): User profile details.
      - `data.id` (string, required): Opaque stable identifier.
      - `data.email` (string, required): Account email address.
      - `data.displayName` (string, required): Visible account name.
      - `data.createdAt` (string, required): UTC timestamp in ISO 8601 date-time format.
      - `data.updatedAt` (string, required): UTC timestamp in ISO 8601 date-time format.
      - `data.version` (integer, required): Revision number used to construct the resource ETag.
  - Example request:

    ```bash
    curl --request POST '/api/v1/users' \
        --header 'Accept: application/json' \
        --header 'Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000' \
        --header 'Content-Type: application/json' \
        --data '{"verificationToken":"opaque_email_verification_token","password":"correct horse battery staple","displayName":"Ada Lovelace"}'
    ```

  - Example success response:

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
  - Errors:
    - `409 Conflict`:
      - `email_in_use`: The email already belongs to an account.
      - `idempotency_key_reused`: The idempotency key was already used with a different request body.
      - `verification_token_used`: The verification token has already been consumed.
    - `422 Unprocessable Content`:
      - `verification_token_invalid`: The verification token is invalid, expired, or superseded by a later request.
      - `weak_password`: The password or another field fails validation.
    - `429 Too Many Requests`:
      - `rate_limited`: Too many account-creation attempts.
    - `500 Internal Server Error`:
      - `internal_error`: The server could not complete the request.
    - `503 Service Unavailable`:
      - `service_unavailable`: A required service is temporarily unavailable.

<a id="createSession"></a>
- **`POST /api/v1/sessions`**
  - Description: Authenticates a user and creates a session. Cookie transport sets `chalktalk_session` as a Secure, HttpOnly, SameSite=Lax cookie and returns an opaque CSRF token bound to that session. The client sends the CSRF token in `X-CSRF-Token` for cookie-authenticated mutations. Bearer transport returns the opaque access token once and does not use a CSRF token. Sessions expire after 30 days.
  - Authentication: None.
  - Access: Public.
  - Request media: `application/json`
  - Request headers:
    - `Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.
    - `Content-Type` (required): Selects one documented request media type.
  - Path parameters:
    - None.
  - Query parameters:
    - None.
  - Request body:
    - Schema: `CreateSessionRequest` (required).
    - `email` (string, required): Account email.
    - `password` (string, required): Account password.
    - `credentialTransport` (enum: cookie, bearer, required): Select secure cookie for web or opaque bearer credential for native.
  - Multipart parts:
    - None.
  - Success: `201 Created`.
  - Response media: `application/json`.
  - Response headers:
    - `Set-Cookie` (conditional): Secure HTTP-only `chalktalk_session` cookie for cookie transport.
  - Response body:
    - `data` (object, required): Authenticated session details.
      - `data.id` (string, required): Opaque stable identifier.
      - `data.user` (object, required): User profile details.
      - `data.credentialTransport` (enum: cookie, bearer, required): Issued credential transport.
      - `data.expiresAt` (string, required): UTC timestamp in ISO 8601 date-time format.
      - `data.accessToken` (string or null, required): Opaque bearer credential returned once for bearer transport; null for cookie transport.
      - `data.csrfToken` (string or null, required): Opaque token bound to the cookie session and sent in `X-CSRF-Token` for cookie-authenticated mutations; null for bearer transport.
  - Example request:

    ```bash
    curl --request POST '/api/v1/sessions' \
        --header 'Accept: application/json' \
        --header 'Content-Type: application/json' \
        --data '{"email":"ada@example.edu","password":"correct horse battery staple","credentialTransport":"bearer"}'
    ```

  - Example cookie-transport success response:

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
        "credentialTransport": "cookie",
        "expiresAt": "2026-10-20T14:30:00Z",
        "accessToken": null,
        "csrfToken": "opaque_csrf_token"
      }
    }
    ```
  - Example bearer-transport success response:

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
        "credentialTransport": "bearer",
        "expiresAt": "2026-10-20T14:30:00Z",
        "accessToken": "opaque_access_token",
        "csrfToken": null
      }
    }
    ```
  - Errors:
    - `401 Unauthorized`:
      - `invalid_credentials`: The email or password is invalid.
    - `422 Unprocessable Content`:
      - `validation_failed`: The credential transport is invalid.
    - `429 Too Many Requests`:
      - `rate_limited`: Too many sign-in attempts.
    - `500 Internal Server Error`:
      - `internal_error`: The server could not complete the request.
    - `503 Service Unavailable`:
      - `service_unavailable`: A required service is temporarily unavailable.

<a id="deleteCurrentSession"></a>
- **`DELETE /api/v1/sessions/current`**
  - Description: Ends the current authenticated session. Revokes only the credential used for this request.
  - Authentication: Either `Cookie: chalktalk_session=<opaque-session>` or `Authorization: Bearer <opaque-token>`.
  - Access: Signed-in user.
  - Request media: None.
  - Request headers:
    - `Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.
    - `Cookie` or `Authorization` (required alternative): Supplies exactly one supported authentication credential.
    - `X-CSRF-Token` (conditional, string): Required with cookie authentication; omitted with bearer authentication.
  - Path parameters:
    - None.
  - Query parameters:
    - None.
  - Request body:
    - None.
  - Multipart parts:
    - None.
  - Success: `204 No Content`.
  - Response media: None.
  - Response headers:
    - None specific to this operation.
  - Response body:
    - None.
  - Example request:

    ```bash
    curl --request DELETE '/api/v1/sessions/current' \
        --header 'Accept: application/json' \
        --header 'Authorization: Bearer opaque_access_token'
    ```

  - Example success response:

    ```http
    204 No Content
    ```
  - Errors:
    - `401 Unauthorized`:
      - `authentication_required`: The session is missing or invalid.
    - `500 Internal Server Error`:
      - `internal_error`: The server could not complete the request.
    - `503 Service Unavailable`:
      - `service_unavailable`: A required service is temporarily unavailable.

<a id="getCurrentUser"></a>
- **`GET /api/v1/users/me`**
  - Description: Retrieves the authenticated user’s account profile.
  - Authentication: Either `Cookie: chalktalk_session=<opaque-session>` or `Authorization: Bearer <opaque-token>`.
  - Access: Signed-in user.
  - Request media: None.
  - Request headers:
    - `Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.
    - `Cookie` or `Authorization` (required alternative): Supplies exactly one supported authentication credential.
  - Path parameters:
    - None.
  - Query parameters:
    - None.
  - Request body:
    - None.
  - Multipart parts:
    - None.
  - Success: `200 OK`.
  - Response media: `application/json`.
  - Response headers:
    - `ETag` (string): Opaque revision token for a later `If-Match` request.
  - Response body:
    - `data` (object, required): User profile details.
      - `data.id` (string, required): Opaque stable identifier.
      - `data.email` (string, required): Account email address.
      - `data.displayName` (string, required): Visible account name.
      - `data.createdAt` (string, required): UTC timestamp in ISO 8601 date-time format.
      - `data.updatedAt` (string, required): UTC timestamp in ISO 8601 date-time format.
      - `data.version` (integer, required): Revision number used to construct the resource ETag.
  - Example request:

    ```bash
    curl --request GET '/api/v1/users/me' \
        --header 'Accept: application/json' \
        --header 'Authorization: Bearer opaque_access_token'
    ```

  - Example success response:

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
  - Errors:
    - `401 Unauthorized`:
      - `authentication_required`: Authentication is required.
    - `500 Internal Server Error`:
      - `internal_error`: The server could not complete the request.
    - `503 Service Unavailable`:
      - `service_unavailable`: A required service is temporarily unavailable.

<a id="updateCurrentUser"></a>
- **`PATCH /api/v1/users/me`**
  - Description: Updates the authenticated user’s account profile. At least one field is required. When `emailVerificationToken` is supplied, the server hashes it to locate a valid, unexpired proof, derives the replacement email from that proof, finds or creates the organization for its canonical school domain, updates the organization membership, updates the account, and consumes the proof atomically. A failed transaction consumes nothing.
  - Authentication: Either `Cookie: chalktalk_session=<opaque-session>` or `Authorization: Bearer <opaque-token>`.
  - Access: Signed-in user.
  - Request media: `application/json`
  - Request headers:
    - `Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.
    - `Cookie` or `Authorization` (required alternative): Supplies exactly one supported authentication credential.
    - `Content-Type` (required): Selects one documented request media type.
    - `If-Match` (required, string): Supplies the ETag from the latest retrieval.
    - `X-CSRF-Token` (conditional, string): Required with cookie authentication; omitted with bearer authentication.
  - Path parameters:
    - None.
  - Query parameters:
    - None.
  - Request body:
    - Schema: `UpdateUserRequest` (required).
    - `displayName` (string, optional): Replacement visible name.
    - `emailVerificationToken` (string, optional): Single-use token proving control of the replacement email address.
  - Multipart parts:
    - None.
  - Success: `200 OK`.
  - Response media: `application/json`.
  - Response headers:
    - `ETag` (string): `"v4"`, the opaque revision token for the returned fourth revision.
  - Response body:
    - `data` (object, required): User profile details.
      - `data.id` (string, required): Opaque stable identifier.
      - `data.email` (string, required): Account email address.
      - `data.displayName` (string, required): Visible account name.
      - `data.createdAt` (string, required): UTC timestamp in ISO 8601 date-time format.
      - `data.updatedAt` (string, required): UTC timestamp in ISO 8601 date-time format.
      - `data.version` (integer, required): Revision number used to construct the resource ETag.
  - Example request:

    ```bash
    curl --request PATCH '/api/v1/users/me' \
        --header 'Accept: application/json' \
        --header 'Authorization: Bearer opaque_access_token' \
        --header 'If-Match: "v3"' \
        --header 'Content-Type: application/json' \
        --data '{"displayName":"Ada Byron","emailVerificationToken":"opaque_email_verification_token"}'
    ```

  - Example success response:

    ```json
    {
      "data": {
        "id": "user_123",
        "email": "ada@newschool.edu",
        "displayName": "Ada Byron",
        "createdAt": "2026-09-20T14:30:00Z",
        "updatedAt": "2026-09-20T14:40:00Z",
        "version": 4
      }
    }
    ```
  - Errors:
    - `401 Unauthorized`:
      - `authentication_required`: Authentication is required.
    - `409 Conflict`:
      - `email_in_use`: The replacement email is already used.
      - `verification_token_used`: The email verification token has already been consumed.
    - `412 Precondition Failed`:
      - `version_conflict`: The supplied ETag is stale.
    - `422 Unprocessable Content`:
      - `validation_failed`: No valid editable field was supplied.
      - `verification_token_invalid`: The email verification token is invalid, expired, or superseded by a later request.
    - `428 Precondition Required`:
      - `precondition_required`: If-Match is required.
    - `500 Internal Server Error`:
      - `internal_error`: The server could not complete the request.
    - `503 Service Unavailable`:
      - `service_unavailable`: A required service is temporarily unavailable.

<a id="changeCurrentUserPassword"></a>
- **`PATCH /api/v1/users/me/password`**
  - Description: Changes the authenticated user’s password. Successfully changing the password revokes the user’s other sessions.
  - Authentication: Either `Cookie: chalktalk_session=<opaque-session>` or `Authorization: Bearer <opaque-token>`.
  - Access: Signed-in user.
  - Request media: `application/json`
  - Request headers:
    - `Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.
    - `Cookie` or `Authorization` (required alternative): Supplies exactly one supported authentication credential.
    - `Content-Type` (required): Selects one documented request media type.
    - `If-Match` (required, string): Supplies the ETag from the latest retrieval.
    - `X-CSRF-Token` (conditional, string): Required with cookie authentication; omitted with bearer authentication.
  - Path parameters:
    - None.
  - Query parameters:
    - None.
  - Request body:
    - Schema: `ChangePasswordRequest` (required).
    - `currentPassword` (string, required): Current password.
    - `newPassword` (string, required): Replacement password.
  - Multipart parts:
    - None.
  - Success: `204 No Content`.
  - Response media: None.
  - Response headers:
    - None specific to this operation.
  - Response body:
    - None.
  - Example request:

    ```bash
    curl --request PATCH '/api/v1/users/me/password' \
        --header 'Accept: application/json' \
        --header 'Authorization: Bearer opaque_access_token' \
        --header 'If-Match: "v3"' \
        --header 'Content-Type: application/json' \
        --data '{"currentPassword":"correct horse battery staple","newPassword":"a newer secure passphrase"}'
    ```

  - Example success response:

    ```http
    204 No Content
    ```
  - Errors:
    - `401 Unauthorized`:
      - `invalid_credentials`: The current password is invalid.
    - `412 Precondition Failed`:
      - `version_conflict`: The supplied ETag is stale.
    - `422 Unprocessable Content`:
      - `weak_password`: The replacement password does not meet the 12–128 character rule.
    - `428 Precondition Required`:
      - `precondition_required`: If-Match is required.
    - `500 Internal Server Error`:
      - `internal_error`: The server could not complete the request.
    - `503 Service Unavailable`:
      - `service_unavailable`: A required service is temporarily unavailable.

<a id="createPasswordResetRequest"></a>
- **`POST /api/v1/password-reset-requests`**
  - Description: Requests a password-reset email. Returns the same response whether or not the email exists, preventing account discovery.
  - Authentication: None.
  - Access: Public.
  - Request media: `application/json`
  - Request headers:
    - `Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.
    - `Content-Type` (required): Selects one documented request media type.
  - Path parameters:
    - None.
  - Query parameters:
    - None.
  - Request body:
    - Schema: `PasswordResetRequest` (required).
    - `email` (string, required): Address that may receive reset mail.
  - Multipart parts:
    - None.
  - Success: `202 Accepted`.
  - Response media: None.
  - Response headers:
    - None specific to this operation.
  - Response body:
    - None.
  - Example request:

    ```bash
    curl --request POST '/api/v1/password-reset-requests' \
        --header 'Accept: application/json' \
        --header 'Content-Type: application/json' \
        --data '{"email":"ada@example.edu"}'
    ```

  - Example success response:

    ```http
    202 Accepted
    ```
  - Errors:
    - `400 Bad Request`:
      - `invalid_request`: The request is malformed.
    - `429 Too Many Requests`:
      - `rate_limited`: Too many reset attempts.
    - `500 Internal Server Error`:
      - `internal_error`: The server could not complete the request.
    - `503 Service Unavailable`:
      - `service_unavailable`: A required service is temporarily unavailable.

<a id="resetPassword"></a>
- **`POST /api/v1/password-resets`**
  - Description: Resets an account password using a password-reset token. Success consumes the token and revokes every existing session for the account.
  - Authentication: None.
  - Access: Public.
  - Request media: `application/json`
  - Request headers:
    - `Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.
    - `Content-Type` (required): Selects one documented request media type.
  - Path parameters:
    - None.
  - Query parameters:
    - None.
  - Request body:
    - Schema: `ResetPasswordRequest` (required).
    - `token` (string, required): One-time reset token from email.
    - `newPassword` (string, required): Replacement password.
  - Multipart parts:
    - None.
  - Success: `204 No Content`.
  - Response media: None.
  - Response headers:
    - None specific to this operation.
  - Response body:
    - None.
  - Example request:

    ```bash
    curl --request POST '/api/v1/password-resets' \
        --header 'Accept: application/json' \
        --header 'Content-Type: application/json' \
        --data '{"token":"reset_token_value","newPassword":"a newer secure passphrase"}'
    ```

  - Example success response:

    ```http
    204 No Content
    ```
  - Errors:
    - `409 Conflict`:
      - `reset_token_used`: The one-time token was already consumed.
    - `422 Unprocessable Content`:
      - `reset_token_invalid`: The token is invalid or expired, or the password fails validation.
    - `500 Internal Server Error`:
      - `internal_error`: The server could not complete the request.
    - `503 Service Unavailable`:
      - `service_unavailable`: A required service is temporarily unavailable.

<a id="deleteCurrentUser"></a>
- **`DELETE /api/v1/users/me`**
  - Description: Deletes the authenticated user’s account. Retained contributions are pseudonymized and all sessions are revoked. The reauthenticationProof field is conditional on deployment policy.
  - Authentication: Either `Cookie: chalktalk_session=<opaque-session>` or `Authorization: Bearer <opaque-token>`.
  - Access: Signed-in user.
  - Request media: `application/json`
  - Request headers:
    - `Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.
    - `Cookie` or `Authorization` (required alternative): Supplies exactly one supported authentication credential.
    - `Content-Type` (required): Selects one documented request media type.
    - `X-CSRF-Token` (conditional, string): Required with cookie authentication; omitted with bearer authentication.
  - Path parameters:
    - None.
  - Query parameters:
    - None.
  - Request body:
    - Schema: `DeleteAccountRequest` (optional).
    - `reauthenticationProof` (string, optional): Recent-authentication proof when deployment policy requires it.
  - Multipart parts:
    - None.
  - Success: `204 No Content`.
  - Response media: None.
  - Response headers:
    - None specific to this operation.
  - Response body:
    - None.
  - Example request:

    ```bash
    curl --request DELETE '/api/v1/users/me' \
        --header 'Accept: application/json' \
        --header 'Authorization: Bearer opaque_access_token' \
        --header 'Content-Type: application/json' \
        --data '{"reauthenticationProof":"recent_auth_proof"}'
    ```

  - Example success response:

    ```http
    204 No Content
    ```
  - Errors:
    - `401 Unauthorized`:
      - `invalid_credentials`: Recent authentication proof is invalid.
    - `409 Conflict`:
      - `last_instructor`: The final instructor must transfer responsibility first.
    - `500 Internal Server Error`:
      - `internal_error`: The server could not complete the request.
    - `503 Service Unavailable`:
      - `service_unavailable`: A required service is temporarily unavailable.
