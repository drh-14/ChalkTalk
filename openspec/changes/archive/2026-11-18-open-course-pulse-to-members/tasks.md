# Tasks

## 1. API

- [x] 1.1 Let any current member read the course pulse, keeping other statistics staff-only. Verify: the pulse integration test shows a student gets the same summary as staff, and non-members still get `404`.
- [x] 1.2 Update the pulse access rules in `documentation/api/statistics.md` and `documentation/openapi.yaml`. Verify: they no longer list `403` for students on the pulse.

## 2. Web

- [x] 2.1 Show the Statistics tab to every member and hide the view switcher from students. Verify: the App test shows a student sees Course pulse, no Activity control, and no per-student requests; a browser test shows the student view.
