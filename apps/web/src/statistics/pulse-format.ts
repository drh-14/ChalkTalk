/** A wait in minutes as "42 min", "1.5 hr", or "3.0 days". */
export function duration(minutes: number | null) {
  if (minutes === null) return "No answers yet";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  if (minutes < 48 * 60) return `${(minutes / 60).toFixed(1)} hr`;
  return `${(minutes / 1440).toFixed(1)} days`;
}

/** The weekday and three-hour block with the most questions. */
export function busiestBlock(hours: number[][]) {
  let best = { day: 0, start: 0, questions: 0 };
  hours.forEach((row, day) => {
    for (let start = 0; start <= 21; start++) {
      const questions = row[start]! + row[start + 1]! + row[start + 2]!;
      if (questions > best.questions) best = { day, start, questions };
    }
  });
  return best;
}
