import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { DecodedEvent } from "../api";
import {
  CALENDAR_RANGE_DAYS,
  buildActivityCalendar,
  sanitizeCalendarRange,
  type CalendarRangeDays,
} from "../utils/activityCalendar";

interface Props {
  events: DecodedEvent[];
}

/** Shade a day cell by its event count relative to the busiest day. */
function intensity(count: number, max: number): number {
  if (count === 0 || max === 0) return 0;
  return 0.25 + 0.75 * (count / max);
}

/**
 * Daily activity grid for a wallet (#1040). Days with events link to the first
 * event of that day; the grid is also described by per-cell labels for screen
 * readers.
 */
export default function ActivityCalendar({ events }: Props) {
  const [range, setRange] = useState<CalendarRangeDays>(30);
  const calendar = useMemo(
    () => buildActivityCalendar(events, sanitizeCalendarRange(range)),
    [events, range],
  );
  const max = Math.max(0, ...calendar.days.map((d) => d.count));

  return (
    <section className="card" aria-labelledby="activity-calendar-heading">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <h3 id="activity-calendar-heading">Activity calendar</h3>
        <div role="radiogroup" aria-label="Calendar range" style={{ display: "flex", gap: 6 }}>
          {CALENDAR_RANGE_DAYS.map((days) => (
            <button
              key={days}
              type="button"
              role="radio"
              aria-checked={range === days}
              onClick={() => setRange(days)}
              style={{ fontSize: 12, fontWeight: range === days ? 600 : 400 }}
            >
              {days}d
            </button>
          ))}
        </div>
      </div>

      {calendar.total === 0 ? (
        <p style={{ color: "var(--muted)", marginTop: 8 }}>
          No dated activity in the last {range} days.
        </p>
      ) : (
        <div
          role="list"
          style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(18px, 1fr))", gap: 4, marginTop: 12 }}
        >
          {calendar.days.map((day) => {
            const label = `${day.date}: ${day.count} event${day.count === 1 ? "" : "s"}`;
            const cellStyle = {
              aspectRatio: "1",
              borderRadius: 3,
              background: `rgba(59,130,246,${intensity(day.count, max)})`,
              border: "1px solid var(--border)",
              display: "block",
            } as const;
            return (
              <div role="listitem" key={day.date}>
                {day.count > 0 && day.firstSeq !== null ? (
                  <Link to={`/event/${day.firstSeq}`} aria-label={label} title={label} style={cellStyle} />
                ) : (
                  <span aria-label={label} title={label} style={cellStyle} />
                )}
              </div>
            );
          })}
        </div>
      )}

      {calendar.undated > 0 && (
        <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 8 }}>
          {calendar.undated} event{calendar.undated === 1 ? "" : "s"} without a ledger close time, not shown on the grid.
        </p>
      )}
    </section>
  );
}
