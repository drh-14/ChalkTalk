## Context
Resources action buttons already use primary/secondary button classes. The compact retry variant needs the same approved spacing.

## Goals / Non-Goals
Use radius-lg (0.85rem), vertical space-3 (0.75rem), horizontal space-5 (1.25rem) for Upload file, Add link, Try again and Load more. Preserve all colors and existing minimum height. Do not restyle native file chooser, links, global buttons, layout or backend.

## Decisions
Use a Resources-scoped button selector with sufficient specificity to override the compact retry rule. No mobile override; responsive layout remains unchanged.

## Risks / Trade-offs
Larger controls consume slightly more space. Real Chromium desktop/mobile tests check computed styles, unchanged colors and no horizontal overflow, alongside existing interaction regressions.
