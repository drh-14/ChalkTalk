# Unified resource PDF viewer

A PDF title opens its document workspace. View extracted text opens the same workspace with the text panel selected; non-PDF uploads retain their inline extracted-text panel.

## Reading and asking

Use PDF version to choose Original or Searchable copy. The latter offers explicit preparation, pending status, retry and a bounded Check again flow. When ready it renders inside the same page-navigation and zoom surface with selectable OCR text. Download original, Download searchable PDF and Open searchable PDF retain direct access to each file. Searchable copies can have lower zoom fidelity.

Questions and Extracted text share the desktop side panel. Extracted text retains readable paragraphs, original line breaks, extraction status, and Download .txt. Questions retain the original file's markers, crop previews, composer and Discussion links. Generation output does not attest crop alignment: the copy therefore omits markers, and Mark an area or Ask about this page switches to Original before creating an anchor.

## Refresh and replacement

The visible viewer refreshes its question list every 15 seconds and when the browser tab regains focus. It also refreshes after posting; mounting again after returning from Discussion fetches a new list. Background updates preserve drafts and the reading position. Loading, failed initial fetch, successful empty results and failed background refresh are distinct states. Refresh failures retain existing data with Retry. A changed file ID displays a reload notice instead of moving the draft onto a different PDF; reload uses the same draft-discard guard as other navigation.

## Phones

PDF, Questions and Extracted text are separate mobile tabs. Inactive panes remain mounted, retaining drafts and text-layout choices. Each active pane owns its vertical scrolling. The viewer measures available height below the responsive navigation. Page controls and PDF version stay in PDF; marking an area uses explicit touch mode, and asking opens the composer in Questions.

## Implementation status

This is the approved behavior and implementation direction. Automated tests, OpenSpec validation, screenshots and gate review are deferred at the user's request; no verified completion or publication is claimed for these new changes.
