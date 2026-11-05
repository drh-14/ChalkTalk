## Approach

For URI actions, parse a reference against a fixed inert HTTPS base. Permit references whose resolved protocol remains HTTP(S), including `./`, `../`, `/`, `?`, and `#` forms. Reject explicit non-HTTP(S) schemes and malformed HTTP(S) absolutes. If the PDF supplies a catalog URI base, require it to be an absolute safe HTTP(S) URL so relative links cannot inherit an unsafe scheme. Keep the existing checks for controls, credentials, action fields, and active PDF features. The fixed base is validation-only; ChalkTalk does not rewrite or resolve a PDF's link at upload time.

## Tradeoff

Relative links may not work after the PDF is downloaded into a different directory or opened in a browser. That is normal PDF-link behavior; preserving original bytes is more important than rewriting them.
