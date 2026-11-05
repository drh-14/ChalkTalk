## Approach

Treat only the exact Office `hyperlink` relationship type in a PPTX package as an external URL relationship. Require `TargetMode="External"` and a non-root relationship source. Validate its target against a fixed HTTPS base, rejecting control characters, backslashes, explicit non-HTTP(S) schemes, credentials, and malformed URLs. Do not resolve a link to an archive entry or rewrite it. All other relationship types retain strict internal-target validation.

## Tradeoff

Relative links may resolve differently after download. This matches the existing PDF-link behavior and preserves the original file.
