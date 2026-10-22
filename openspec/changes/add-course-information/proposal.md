## Why
Course members need a single place for course information, syllabus and staff office-hour details, alongside course resources.

## What Changes
- Add Course information and Staff secondary tabs, preserving the existing Resources URL and initial view.
- Add instructor-managed Markdown information, HTTP(S) website and one validated syllabus.
- Project current TA/instructor memberships and names with instructor-managed contact, location and office-hour text.
- Enforce same-course membership, archived read-only behavior, conditional saves and reference-safe syllabus replacement.

## Capabilities
### New Capabilities
- `course-information`: Membership-authorized information, syllabus and current staff presentation.
### Modified Capabilities
- `course-files`: Preserve active syllabus references when standalone file deletion is requested.

## Impact
New migration 028, API/service and browser modules, narrow file transaction and cleanup guards; existing validators, storage, worker and Markdown controls. No dependencies or unrelated documentation.
