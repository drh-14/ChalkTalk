# Design

## Context

`PostBody` renders every body in the browser with `react-markdown`, `remark-math`, `rehype-sanitize`, and `rehype-katex`. The API already parses bodies with `remark-gfm` for digest emails and notification excerpts, so the browser is the one place GFM is missing. The importer converts Piazza HTML with Turndown, which by default flattens `<table>` into one paragraph per cell.

## Decisions

- **Use `remark-gfm` in the browser, not a tables-only plugin.** It matches the server's parsing, so what an email shows and what the page shows agree. The added syntax (strikethrough, task lists, autolinks) is rare in existing posts and renders as users would expect. `rehype-sanitize`'s default schema already allows table elements, `del`, and disabled checkbox inputs, so no schema change is needed.
- **Scroll wide tables in a wrapper.** A `table` component override wraps the table in a `div` with `overflow-x: auto`, so the page never scrolls sideways on phones.
- **Custom Turndown rule instead of `turndown-plugin-gfm`.** That plugin keeps tables without `<th>` header rows as raw HTML, and Piazza's tables (including the grade distributions) use `<td>` everywhere. The rule converts each cell's children with the same Turndown instance, so links, emphasis, and math survive, then collapses whitespace to one line and escapes `|`.

## Risks

- Bodies that relied on CommonMark-only rendering change slightly (a bare URL becomes a link, `~~x~~` is struck through). Accepted: it matches the emails.
- `remark-gfm` adds roughly 20 kB gzipped to the web bundle, loaded with the post view.
