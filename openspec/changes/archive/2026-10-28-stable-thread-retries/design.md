## Decision

The form owns a key for its current text submission and invalidates it on edit or success. Attachment uploads retain a key per message and exact selected file content until success; a changed file replaces it. The API contract stays unchanged.
