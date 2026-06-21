export interface SnapshotTotals {
  date: Date | string;
  views: number;
  followers: number;
  likes: number;
}

export interface DailyAnalyticsPoint {
  date: string;
  views: number;
  followers: number;
  likes: number;
}

function dayKey(value: Date | string): string {
  return new Date(value).toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function buildDailyDeltaSeries(
  startDate: Date,
  days: number,
  snapshots: SnapshotTotals[],
): DailyAnalyticsPoint[] {
  const snapshotMap = new Map<string, Omit<SnapshotTotals, 'date'>>();
  for (const snapshot of snapshots) {
    snapshotMap.set(dayKey(snapshot.date), {
      views: snapshot.views,
      followers: snapshot.followers,
      likes: snapshot.likes,
    });
  }

  const previousKey = dayKey(addDays(startDate, -1));
  let previous = snapshotMap.get(previousKey) ?? null;
  const data: DailyAnalyticsPoint[] = [];

  for (let i = 0; i < days; i++) {
    const date = addDays(startDate, i);
    const key = dayKey(date);
    const current = snapshotMap.get(key);

    data.push({
      date: key,
      views: current && previous ? Math.max(0, current.views - previous.views) : 0,
      followers: current?.followers ?? previous?.followers ?? 0,
      likes: current && previous ? Math.max(0, current.likes - previous.likes) : 0,
    });

    if (current) previous = current;
  }

  return data;
}
