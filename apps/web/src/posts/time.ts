export type PostTime = { label: string; title: string; dateTime: string };

const minute = 60 * 1000;
const hour = 60 * minute;
const day = 24 * hour;
const relative = new Intl.RelativeTimeFormat("en", { numeric: "always" });
const shortDate = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
});
const shortDateWithYear = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  year: "numeric",
});
const fullDateTime = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
});

export function formatPostTime(
  createdAt: string,
  now = new Date(),
): PostTime | undefined {
  const created = new Date(createdAt);
  if (!createdAt || Number.isNaN(created.getTime())) return undefined;
  const elapsed = now.getTime() - created.getTime();
  const label =
    elapsed < minute
      ? "just now"
      : elapsed < hour
        ? relative.format(-Math.floor(elapsed / minute), "minute")
        : elapsed < day
          ? relative.format(-Math.floor(elapsed / hour), "hour")
          : elapsed < 7 * day
            ? relative.format(-Math.floor(elapsed / day), "day")
            : (created.getFullYear() === now.getFullYear()
                ? shortDate
                : shortDateWithYear
              ).format(created);
  return { label, title: fullDateTime.format(created), dateTime: createdAt };
}
