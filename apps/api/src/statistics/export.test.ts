import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StatisticsService } from "./service.js";

const courseId = "019a0b68-3857-799a-8494-709330948d46";
const staffId = "019a0b68-3857-799a-8494-709330948d47";
function service(role = "ta") {
  const query = vi.fn(async ({ text }: { text: string }) => {
    if (text.includes("SELECT m.role,c.created_at"))
      return { rows: [{ role, created_at: new Date("2026-10-01T00:00:00Z") }] };
    if (text.includes("FROM course_memberships m JOIN users u"))
      return {
        rows: [
          {
            id: "019a0b68-3857-799a-8494-709330948d48",
            display_name: "=SUM(1,1)",
            questions_created: 2,
            answers_contributed: 1,
            posts_viewed: 3,
          },
          {
            id: "019a0b68-3857-799a-8494-709330948d49",
            display_name: 'Zero, "Quoted"\nName',
            questions_created: 0,
            answers_contributed: 0,
            posts_viewed: 0,
          },
        ],
      };
    if (text.includes("avg(GREATEST")) return { rows: [{ average: null }] };
    if (text.includes("FROM posts WHERE"))
      return { rows: [{ date: "2026-10-21", count: 2 }] };
    return { rows: [] };
  });
  return {
    statistics: new StatisticsService({ query } as unknown as Pool),
  };
}

describe("statistics CSV exports", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-21T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("exports zero-filled daily activity with fixed headers and UTC rows", async () => {
    const { statistics } = service();
    const csv = await statistics.exportDaily(courseId, staffId, "7d");
    expect(csv).toContain(
      "date,questions_created,answers_created,posts_viewed\r\n",
    );
    expect(csv).toContain("2026-10-21,2,0,0\r\n");
    expect(csv.trim().split("\n")).toHaveLength(8);
  });

  it("safely encodes roster display names", async () => {
    const { statistics } = service();
    const csv = await statistics.exportStudents(courseId, staffId, "30d");
    expect(csv).toContain(
      "user_id,display_name,questions_created,answers_contributed,posts_viewed\r\n",
    );
    expect(csv).toContain('"\'=SUM(1,1)",2,1,3');
    expect(csv).toContain('"Zero, ""Quoted""\nName",0,0,0');
  });

  it("rejects a student before producing export data", async () => {
    const { statistics } = service("student");
    await expect(
      statistics.exportStudents(courseId, staffId, "7d"),
    ).rejects.toMatchObject({ status: 403, code: "permission_denied" });
  });
});
