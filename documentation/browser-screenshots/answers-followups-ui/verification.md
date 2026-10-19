# Shared answer and followup browser verification

These screenshots were captured in a real Playwright browser against the Vite-rendered `QuestionResponses` component with mocked API responses on 2026-10-13. The temporary preview harness was removed after verification.

| Scenario                            | Observable result                                                                                        | Screenshot                                                   |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Empty question                      | Student and staff areas are distinct; zero-followup prompt is visible.                                   | [01-empty-discussion.png](01-empty-discussion.png)           |
| Followup composer                   | Opening the prompt shows the shared Markdown and LaTeX toolbar.                                          | [02-followup-composer.png](02-followup-composer.png)         |
| Populated question and nested reply | Both answer areas, rendered math, upvote count after PUT, root, and direct child are visible.            | [03-populated-thread-vote.png](03-populated-thread-vote.png) |
| Shared slot create race             | `409 answer_kind_exists` refreshes the occupied slot while the local create draft remains in the editor. | [04-create-race-draft.png](04-create-race-draft.png)         |
| Stale edit                          | `412 version_conflict` allows an explicit refresh while the local edit draft remains intact.             | [05-stale-edit-draft.png](05-stale-edit-draft.png)           |

The following screenshots exercise the full `Discussion` question-detail page, including its post list, question content, shared answers, and followups. A temporary Vite page supplied mocked API responses and was removed after the browser run.

| Scenario                      | Observable result                                                                                                                                      | Screenshot                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Empty question                | The student green area starts with a compact answer prompt; the staff amber area is read-only for a student; the zero-followup prompt remains visible. | [06-full-question-empty.png](06-full-question-empty.png)                                 |
| Answer composer               | Clicking the answer prompt opens the shared Markdown and LaTeX editor; Cancel returns to the compact prompt.                                           | [07-full-question-answer-composer.png](07-full-question-answer-composer.png)             |
| Followup composer             | Clicking the followup prompt opens the shared Markdown and LaTeX editor.                                                                               | [08-full-question-followup-composer.png](08-full-question-followup-composer.png)         |
| Populated question            | Student and staff answers are distinct; a voted answer shows the updated count below its text; a root and nested reply are visible.                    | [09-full-question-populated-vote-thread.png](09-full-question-populated-vote-thread.png) |
| Stale answer edit             | A `412 version_conflict` keeps the local draft visible and offers explicit refresh.                                                                    | [10-full-question-stale-edit.png](10-full-question-stale-edit.png)                       |
| Switch questions with a draft | After entering an unsent answer on the sky question, selecting the grass question shows its own compact answer prompt without the sky draft.           | [11-question-switch-clears-draft.png](11-question-switch-clears-draft.png)               |
