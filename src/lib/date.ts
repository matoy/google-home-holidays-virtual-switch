import { PARIS_TIMEZONE } from "./config";

export interface ZonedDateTimeParts {
  ymd: string;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const YMD_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getDateTimeFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

/**
 * Extracts calendar date and wall-clock time components for an instant in any IANA timezone.
 */
export function dateToZonedParts(date: Date, timeZone: string = PARIS_TIMEZONE): ZonedDateTimeParts {
  const parts = getDateTimeFormatter(timeZone).formatToParts(date);
  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") {
      map[part.type] = part.value;
    }
  }

  const year = Number(map.year);
  const month = Number(map.month);
  const day = Number(map.day);
  const rawHour = Number(map.hour);
  const hour = rawHour === 24 ? 0 : rawHour;
  const minute = Number(map.minute);
  const second = Number(map.second);

  return {
    ymd: formatYmd(year, month, day),
    year,
    month,
    day,
    hour,
    minute,
    second,
  };
}

export function getParisNowParts(now: Date = new Date()): ZonedDateTimeParts {
  return dateToZonedParts(now, PARIS_TIMEZONE);
}

export function parseYmd(ymd: string): { year: number; month: number; day: number } {
  const match = YMD_PATTERN.exec(ymd);
  if (!match) {
    throw new Error(`Invalid YYYY-MM-DD date string: "${ymd}"`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() + 1 !== month ||
    check.getUTCDate() !== day
  ) {
    throw new Error(`Non-existent calendar date: "${ymd}"`);
  }

  return { year, month, day };
}

export function isValidYmd(ymd: string): boolean {
  try {
    parseYmd(ymd);
    return true;
  } catch {
    return false;
  }
}

export function formatYmd(year: number, month: number, day: number): string {
  const y = String(year).padStart(4, "0");
  const m = String(month).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Pure calendar arithmetic using UTC date slots to avoid DST 23h/25h shift issues.
 */
export function addDaysYmd(ymd: string, deltaDays: number): string {
  const { year, month, day } = parseYmd(ymd);
  const dt = new Date(Date.UTC(year, month - 1, day + deltaDays));
  return formatYmd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

/**
 * Returns day of week for a YYYY-MM-DD calendar date: 0 = Sunday ... 6 = Saturday.
 */
export function getDayOfWeekYmd(ymd: string): number {
  const { year, month, day } = parseYmd(ymd);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function compareYmd(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function formatHumanDate(ymd: string, locale: string = "en-GB"): string {
  const { year, month, day } = parseYmd(ymd);
  const utcMidday = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  return new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(utcMidday);
}
