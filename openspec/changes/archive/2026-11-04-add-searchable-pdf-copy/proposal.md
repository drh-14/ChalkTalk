# Why

Readers want to inspect the document with selectable OCR text while its columns, tables and page appearance stay in place. Flat extracted text cannot supply an aligned document layer. The user selected an unchanged-looking searchable PDF rather than a visible word overlay.

# What Changes

- Add an on-demand **Searchable PDF** option to the existing extracted-text panel for PDF uploads.
- Generate a separate cached PDF in the background with existing Poppler, Tesseract and qpdf tools. Each rendered page carries an invisible text layer aligned to its image.
- Offer protected inline viewing, open-in-browser and download actions for the current file revision.
- Bind derived objects to their immutable course file and extend replacement/removal/course-deletion cleanup.
- Preserve the original file download and existing ready search text throughout generation.

# Capabilities

## Added Capabilities

- `resource-searchable-pdfs`: background creation, lifecycle, protected access and UI for searchable PDF copies.

# Impact

One additive database migration, the resource API/service, extraction worker/tool helpers, derived-object cleanup, existing file text panel/client/styles, API/OpenAPI/database references and narrowly scoped verification. No new service, browser PDF library or package dependency. Derived pages are rasterized at bounded resolution, so zoom detail, native-text exactness and original interactive features can differ; the immutable original remains the fidelity fallback. Existing uploads generate on demand, without a full-library backfill.

# Delivery

The user explicitly prioritizes testing the local demo and deferred broad tests, no-mistakes and publication. Complete only essential specification-first checks and one focused mocked-browser flow with screenshots, then make the reported 18-page upload available in the demo. Keep the original `.txt` and readable/original text views.
