# Semantic search browser verification

A real Chromium session exercised the changed Related questions flow against the local Vite frontend with mocked JSON API responses. The backend semantic ranking and persistence were separately tested against PostgreSQL/pgvector; these browser screenshots do not claim full-stack coverage.

- [Question draft with a semantic-only related result](related-question-semantic.png): typed a title and body, verified the request kept the existing `OR` expression in `q` and sent a separate natural-language `semanticQuery`, then verified the returned suggestion rendered.
- [Note draft without Related questions](note-without-related-questions.png): switched the same composer to Note, verified no Related questions panel or semantic request appeared.
