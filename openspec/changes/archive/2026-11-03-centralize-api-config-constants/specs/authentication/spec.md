## ADDED Requirements

### Requirement: Stable authentication and collaboration rate limits

The API SHALL enforce the existing per-email, per-IP, and per-user rate-limit thresholds independent of runtime `RATE_LIMIT_*` environment variables. The thresholds SHALL remain verification per email 5 and per IP 100, login per email 10 and per IP 100, password reset per email 5 and per IP 100, signup per IP 100, collaboration session creation per user 30, and collaboration ticket issuance per user 300 for their existing windows.

#### Scenario: Legacy rate-limit variables are present

- **WHEN** the API starts with any legacy `RATE_LIMIT_*` variable set to a different or invalid value
- **THEN** the API uses the documented thresholds and does not fail startup because of that variable

### Requirement: Configurable frontend URL with safe localhost defaults

The API SHALL default its allowed frontend origin and canonical frontend URL to `https://localhost:5173`. It SHALL continue to accept `FRONTEND_ORIGINS` and `FRONTEND_BASE_URL` runtime overrides, require HTTPS origins, and require the canonical URL to be one of the allowed origins.

#### Scenario: No frontend URL variables are set

- **WHEN** the API starts without `FRONTEND_ORIGINS` and `FRONTEND_BASE_URL`
- **THEN** both settings use `https://localhost:5173`

#### Scenario: Deployment supplies frontend URLs

- **WHEN** the API starts with valid HTTPS overrides and the canonical URL is an allowed origin
- **THEN** the API uses those overrides

#### Scenario: Deployment supplies an invalid frontend URL

- **WHEN** the API starts with a non-HTTPS origin or canonical URL outside the allowed origins
- **THEN** startup fails with a configuration error
