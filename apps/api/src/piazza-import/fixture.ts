import type { PiazzaExport } from "./convert.js";

/** A small synthetic Piazza class covering every shape the importer handles. */
export const piazzaFixture = (): PiazzaExport => ({
  network: {
    id: "net1",
    name: "Software Engineering",
    courseNumber: "CSE 416",
    term: "Fall 2026",
  },
  selfUid: "me1",
  users: [
    { id: "prof1", name: "Pat Professor", role: "professor" },
    { id: "ta1", name: "Tia Assistant", role: "ta" },
    { id: "stu1", name: "Sam Student", role: "student" },
    { id: "me1", name: "Me Myself", role: "student" },
  ],
  posts: [
    {
      id: "p1",
      nr: 1,
      type: "note",
      status: "active",
      created: "2026-09-01T12:00:00Z",
      folders: ["Logistics"],
      pinned: true,
      history: [
        {
          anon: "no",
          uid: "prof1",
          subject: "Welcome &amp; syllabus",
          content:
            '<p>Read the <a href="/class_profile/get_resource/net1/x">syllabus</a>. It costs $5.</p>',
          created: "2026-09-01T12:00:00Z",
        },
      ],
      children: [],
    },
    {
      id: "p2",
      nr: 2,
      type: "question",
      status: "active",
      created: "2026-09-02T10:00:00Z",
      folders: ["hw1", "exam"],
      history: [
        // Newest first, as Piazza returns it.
        {
          anon: "stud",
          subject: "How does $$O(n^2)$$ arise?",
          content: "<p>Edited: why is it <b>quadratic</b> for $$n_1$$?</p>",
          created: "2026-09-02T11:00:00Z",
        },
        {
          anon: "stud",
          subject: "How does it arise?",
          content: "<p>Why quadratic?</p>",
          created: "2026-09-02T10:00:00Z",
        },
      ],
      children: [
        {
          id: "a1",
          type: "s_answer",
          created: "2026-09-02T12:00:00Z",
          history: [
            {
              anon: "no",
              uid: "stu1",
              content: "<p>Nested loops.</p>",
              created: "2026-09-02T12:00:00Z",
            },
          ],
          tag_endorse: [
            { id: "prof1", role: "professor" },
            { id: "me1", role: "student" },
          ],
        },
        {
          id: "a2",
          type: "i_answer",
          created: "2026-09-02T13:00:00Z",
          history: [
            {
              anon: "no",
              uid: "prof1",
              content: "<p>Two loops over n, edited.</p>",
              created: "2026-09-02T14:00:00Z",
            },
            {
              anon: "no",
              uid: "ta1",
              content: "<p>Two loops.</p>",
              created: "2026-09-02T13:00:00Z",
            },
          ],
        },
        {
          id: "f1",
          type: "followup",
          uid: "me1",
          anon: "no",
          subject: "<p>What about three loops?</p>",
          created: "2026-09-03T09:00:00Z",
          no_answer: 0,
          tag_good: [{ id: "stu1" }],
          children: [
            {
              id: "r1",
              type: "feedback",
              uid: "ta1",
              anon: "no",
              subject: "Cubic.",
              created: "2026-09-03T10:00:00Z",
            },
          ],
        },
        {
          id: "f2",
          type: "followup",
          anon: "stud",
          subject: "<p>Anonymous worry</p>",
          created: "2026-09-04T09:00:00Z",
          no_answer: 1,
        },
      ],
    },
    {
      id: "p3",
      type: "poll",
      status: "active",
      created: "2026-09-05T10:00:00Z",
      history: [
        {
          anon: "no",
          uid: "ghost1",
          subject: "Pick a day",
          content: "Mon or Tue?",
          created: "2026-09-05T10:00:00Z",
        },
      ],
    },
    {
      id: "p4",
      type: "question",
      status: "private",
      created: "2026-09-06T10:00:00Z",
      history: [
        {
          anon: "no",
          uid: "me1",
          subject: "Private grade question",
          content: "<md>**My** grade</md>",
          created: "2026-09-06T10:00:00Z",
        },
      ],
    },
    {
      id: "p5",
      type: "question",
      status: "deleted",
      created: "2026-09-07T10:00:00Z",
      history: [
        {
          anon: "no",
          uid: "stu1",
          subject: "Gone",
          content: "gone",
          created: "2026-09-07T10:00:00Z",
        },
      ],
    },
  ],
});
