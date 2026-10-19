// The reading streak and this week's pages, worked out from the Asia/Dhaka
// days a person read on. Pure, so it is tested on its own.

export interface ReadingDay {
  date: string; // YYYY-MM-DD
  pages: number;
}

export interface ReadingSummary {
  // Days in a row with pages read, up to today -- or up to yesterday while
  // today has none yet, so the streak doesn't break before the day is over.
  streak: number;
  // The longest such run ever.
  best: number;
  // Saturday to Friday of this week (the app's weeks start on Saturday):
  // the pages read each day, 0 for a day with none or still to come.
  week: ReadingDay[];
}

const shift = (day: string, by: number): string => new Date(Date.parse(`${day}T00:00:00.000Z`) + by * 86_400_000).toISOString().slice(0, 10);

export function readingSummary(days: ReadingDay[], today: string): ReadingSummary {
  const pages = new Map(days.filter((day) => day.pages > 0).map((day) => [day.date, day.pages]));

  let streak = 0;
  for (let day = pages.has(today) ? today : shift(today, -1); pages.has(day); day = shift(day, -1)) streak++;

  let best = 0;
  let run = 0;
  let previous: string | null = null;
  for (const date of [...pages.keys()].sort()) {
    run = previous !== null && shift(previous, 1) === date ? run + 1 : 1;
    best = Math.max(best, run);
    previous = date;
  }

  // getUTCDay: 0 Sunday ... 6 Saturday; Saturday opens the week.
  const saturday = shift(today, -((new Date(`${today}T00:00:00.000Z`).getUTCDay() + 1) % 7));
  const week = Array.from({ length: 7 }, (_, i) => {
    const date = shift(saturday, i);
    return { date, pages: pages.get(date) ?? 0 };
  });

  return { streak, best, week };
}
