import ical from 'node-ical';
import axios from 'axios';

const DOE_CALENDAR_URL = 'https://www.schools.nyc.gov/calendar';

const TZ = 'America/New_York';

function fmt(date: Date, allDay: boolean): string {
  if (allDay) {
    return date.toLocaleDateString('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric' });
  }
  return date.toLocaleString('en-US', {
    timeZone: TZ,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export async function getCalendarEvents(person: string, daysAhead = 7): Promise<string> {
  const envKey = `${person.toUpperCase()}_CALENDAR_ICS_URL`;
  const url = process.env[envKey];
  if (!url) return `No calendar configured for ${person}.`;

  const now = new Date();
  const cutoff = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);

  try {
    const data = await ical.fromURL(url);
    const events = (Object.values(data) as ical.CalendarComponent[])
      .filter((e): e is ical.VEvent => e.type === 'VEVENT' && !!e.start)
      .filter((e) => new Date(e.start) >= now && new Date(e.start) <= cutoff)
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

    if (!events.length) return `No events for ${person} in the next ${daysAhead} days.`;

    return events
      .map((e) => {
        const allDay = e.datetype === 'date';
        const start = fmt(new Date(e.start), allDay);
        const end = e.end ? fmt(new Date(e.end), allDay) : null;
        const timeStr = end && !allDay ? `${start} – ${fmt(new Date(e.end!), false).replace(/^.+?, /, '')}` : start;
        return `${timeStr}: ${e.summary}`;
      })
      .join('\n');
  } catch {
    return `Failed to fetch calendar for ${person}.`;
  }
}

let doeCache: { events: string; fetchedAt: number } | null = null;
const DOE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export async function getDOECalendar(): Promise<string> {
  if (doeCache && Date.now() - doeCache.fetchedAt < DOE_CACHE_TTL_MS) {
    return doeCache.events;
  }

  try {
    const { data: html } = await axios.get<string>(DOE_CALENDAR_URL, { timeout: 8000 });

    const rawDates = [...html.matchAll(/<p class="date">([^<]+)<\/p>/g)].map((m) => m[1].trim());
    const rawTitles = [...html.matchAll(/<h2 class="title">\s*<a[^>]*>([^<]+)<\/a>/g)].map((m) =>
      m[1].trim().replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
    );

    const lines: string[] = [];
    for (let i = 0; i < Math.min(rawDates.length, rawTitles.length); i++) {
      lines.push(`${rawDates[i]}: ${rawTitles[i]}`);
    }

    if (!lines.length) return 'No NYC DOE school events found.';
    const result = lines.join('\n');
    doeCache = { events: result, fetchedAt: Date.now() };
    return result;
  } catch {
    return 'Failed to fetch NYC DOE calendar.';
  }
}
