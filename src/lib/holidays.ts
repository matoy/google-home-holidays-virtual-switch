import { getAppConfig } from "./config";
import { addDaysYmd, compareYmd, getDayOfWeekYmd, getParisNowParts } from "./date";
import { parseIcsEvents, type ParsedIcsEvent } from "./ics";

export interface HolidayPeriod {
  id: string;
  title: string;
  summaries: string[];
  startDate: string; // inclusive YYYY-MM-DD
  endDate: string; // exclusive YYYY-MM-DD
  firstSaturday: string | null;
  firstSunday: string | null;
}

export type SwitchReason =
  | "outside_holidays"
  | "first_saturday_excluded"
  | "first_sunday_excluded"
  | "holiday_active";

export interface SwitchEvaluation {
  date: string;
  isOn: boolean;
  reason: SwitchReason;
  reasonLabel: string;
  activePeriod: HolidayPeriod | null;
}

export interface NextTransition {
  date: string;
  nextState: boolean;
  reason: SwitchReason;
  reasonLabel: string;
}

export interface HolidayScheduleSnapshot {
  calendarUrl: string;
  source: "live" | "stale-cache";
  fetchedAt: string;
  parisNow: {
    date: string;
    time: string;
  };
  current: SwitchEvaluation;
  yesterday: SwitchEvaluation;
  nextTransition: NextTransition | null;
  periods: HolidayPeriod[];
  ignoredEvents: ParsedIcsEvent[];
}

interface CachedIcsEntry {
  url: string;
  rawIcs: string;
  fetchedAtMs: number;
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const FETCH_TIMEOUT_MS = 8000;

let cachedIcs: CachedIcsEntry | null = null;

export function normalizeFrenchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Determines whether a parsed Zone-C VEVENT represents a school holiday period.
 * Matches "Vacances ..." and "Pont de l'Ascension"; excludes "Rentrée scolaire",
 * "Prérentrée des enseignants", etc.
 */
export function isSchoolHolidayEvent(event: ParsedIcsEvent): boolean {
  const normalizedSummary = normalizeFrenchText(event.summary);
  if (!normalizedSummary) {
    return false;
  }
  if (normalizedSummary.includes("rentree")) {
    return false;
  }
  if (normalizedSummary.includes("vacances")) {
    return true;
  }
  if (normalizedSummary.includes("pont") && normalizedSummary.includes("ascension")) {
    return true;
  }
  return false;
}

function findFirstWeekendDays(
  startDate: string,
  endDate: string,
): { firstSaturday: string | null; firstSunday: string | null } {
  let firstSaturday: string | null = null;
  let firstSunday: string | null = null;
  let cursor = startDate;

  while (compareYmd(cursor, endDate) < 0) {
    const dow = getDayOfWeekYmd(cursor);
    if (dow === 6 && !firstSaturday) {
      firstSaturday = cursor;
    } else if (dow === 0 && !firstSunday) {
      firstSunday = cursor;
    }
    if (firstSaturday && firstSunday) {
      break;
    }
    cursor = addDaysYmd(cursor, 1);
  }

  return { firstSaturday, firstSunday };
}

function addUniqueSummary(target: string[], summary: string): void {
  const cleaned = summary.trim();
  if (cleaned && !target.includes(cleaned)) {
    target.push(cleaned);
  }
}

/**
 * Filters, deduplicates, and merges overlapping/contiguous Zone-C holiday events
 * (e.g. identical events emitted per academy) and computes the 1st Saturday & 1st Sunday.
 */
export function buildHolidayPeriods(events: ParsedIcsEvent[]): {
  periods: HolidayPeriod[];
  ignoredEvents: ParsedIcsEvent[];
} {
  const holidayEvents: ParsedIcsEvent[] = [];
  const ignoredEvents: ParsedIcsEvent[] = [];

  for (const event of events) {
    if (isSchoolHolidayEvent(event)) {
      holidayEvents.push(event);
    } else {
      ignoredEvents.push(event);
    }
  }

  const sorted = [...holidayEvents].sort((a, b) => {
    const startCmp = compareYmd(a.startDate, b.startDate);
    return startCmp !== 0 ? startCmp : compareYmd(a.endDate, b.endDate);
  });

  const mergedRaw: Array<{ startDate: string; endDate: string; summaries: string[] }> = [];

  for (const ev of sorted) {
    const last = mergedRaw[mergedRaw.length - 1];
    if (last && compareYmd(ev.startDate, last.endDate) <= 0) {
      if (compareYmd(ev.endDate, last.endDate) > 0) {
        last.endDate = ev.endDate;
      }
      addUniqueSummary(last.summaries, ev.summary);
    } else {
      const summaries: string[] = [];
      addUniqueSummary(summaries, ev.summary);
      mergedRaw.push({
        startDate: ev.startDate,
        endDate: ev.endDate,
        summaries,
      });
    }
  }

  const periods: HolidayPeriod[] = mergedRaw.map((item) => {
    const { firstSaturday, firstSunday } = findFirstWeekendDays(item.startDate, item.endDate);
    return {
      id: `${item.startDate}_${item.endDate}`,
      title: item.summaries[0] || "Vacances scolaires",
      summaries: item.summaries,
      startDate: item.startDate,
      endDate: item.endDate,
      firstSaturday,
      firstSunday,
    };
  });

  return { periods, ignoredEvents };
}

/**
 * Evaluates the virtual switch state for a given Europe/Paris YYYY-MM-DD calendar date.
 */
export function evaluateSwitchForDate(periods: HolidayPeriod[], ymd: string): SwitchEvaluation {
  const activePeriod =
    periods.find(
      (period) => compareYmd(period.startDate, ymd) <= 0 && compareYmd(ymd, period.endDate) < 0,
    ) || null;

  if (!activePeriod) {
    return {
      date: ymd,
      isOn: false,
      reason: "outside_holidays",
      reasonLabel: "Outside school holidays",
      activePeriod: null,
    };
  }

  if (activePeriod.firstSaturday === ymd) {
    return {
      date: ymd,
      isOn: false,
      reason: "first_saturday_excluded",
      reasonLabel: `${activePeriod.title} — 1st Saturday excluded`,
      activePeriod,
    };
  }

  if (activePeriod.firstSunday === ymd) {
    return {
      date: ymd,
      isOn: false,
      reason: "first_sunday_excluded",
      reasonLabel: `${activePeriod.title} — 1st Sunday excluded`,
      activePeriod,
    };
  }

  return {
    date: ymd,
    isOn: true,
    reason: "holiday_active",
    reasonLabel: `${activePeriod.title} — active`,
    activePeriod,
  };
}

export function findNextTransition(
  periods: HolidayPeriod[],
  fromDate: string,
  maxScanDays: number = 420,
): NextTransition | null {
  const baseEval = evaluateSwitchForDate(periods, fromDate);

  for (let offset = 1; offset <= maxScanDays; offset++) {
    const candidateDate = addDaysYmd(fromDate, offset);
    const candidateEval = evaluateSwitchForDate(periods, candidateDate);
    if (candidateEval.isOn !== baseEval.isOn) {
      return {
        date: candidateDate,
        nextState: candidateEval.isOn,
        reason: candidateEval.reason,
        reasonLabel: candidateEval.reasonLabel,
      };
    }
  }

  return null;
}

export async function fetchRawZoneCIcs(options?: {
  forceRefresh?: boolean;
  calendarUrl?: string;
}): Promise<{ rawIcs: string; source: "live" | "stale-cache"; fetchedAt: string }> {
  const url = options?.calendarUrl || getAppConfig().calendarIcsUrl;
  const nowMs = Date.now();

  if (
    !options?.forceRefresh &&
    cachedIcs &&
    cachedIcs.url === url &&
    nowMs - cachedIcs.fetchedAtMs < CACHE_TTL_MS
  ) {
    return {
      rawIcs: cachedIcs.rawIcs,
      source: "live",
      fetchedAt: new Date(cachedIcs.fetchedAtMs).toISOString(),
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      cache: options?.forceRefresh ? "no-store" : "default",
      headers: {
        Accept: "text/calendar, text/plain, */*",
      },
    });

    if (!response.ok) {
      throw new Error(`ICS upstream returned HTTP ${response.status}`);
    }

    const rawIcs = await response.text();
    if (!rawIcs.includes("BEGIN:VCALENDAR")) {
      throw new Error("Upstream response is not a valid iCalendar payload");
    }

    cachedIcs = { url, rawIcs, fetchedAtMs: nowMs };
    return {
      rawIcs,
      source: "live",
      fetchedAt: new Date(nowMs).toISOString(),
    };
  } catch (err) {
    if (cachedIcs && cachedIcs.url === url) {
      console.warn("Falling back to cached Zone-C ICS after fetch failure:", err);
      return {
        rawIcs: cachedIcs.rawIcs,
        source: "stale-cache",
        fetchedAt: new Date(cachedIcs.fetchedAtMs).toISOString(),
      };
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export function evaluateScheduleFromIcs(
  rawIcs: string,
  options?: {
    targetDate?: string;
    now?: Date;
    calendarUrl?: string;
    source?: "live" | "stale-cache";
    fetchedAt?: string;
  },
): HolidayScheduleSnapshot {
  const now = options?.now || new Date();
  const parisNowParts = getParisNowParts(now);
  const targetDate = options?.targetDate || parisNowParts.ymd;

  const events = parseIcsEvents(rawIcs);
  const { periods, ignoredEvents } = buildHolidayPeriods(events);
  const current = evaluateSwitchForDate(periods, targetDate);
  const yesterday = evaluateSwitchForDate(periods, addDaysYmd(targetDate, -1));
  const nextTransition = findNextTransition(periods, targetDate);

  const hh = String(parisNowParts.hour).padStart(2, "0");
  const mm = String(parisNowParts.minute).padStart(2, "0");
  const ss = String(parisNowParts.second).padStart(2, "0");

  return {
    calendarUrl: options?.calendarUrl || getAppConfig().calendarIcsUrl,
    source: options?.source || "live",
    fetchedAt: options?.fetchedAt || now.toISOString(),
    parisNow: {
      date: parisNowParts.ymd,
      time: `${hh}:${mm}:${ss}`,
    },
    current,
    yesterday,
    nextTransition,
    periods,
    ignoredEvents,
  };
}

export async function getHolidayScheduleSnapshot(options?: {
  forceRefresh?: boolean;
  targetDate?: string;
  now?: Date;
}): Promise<HolidayScheduleSnapshot> {
  const calendarUrl = getAppConfig().calendarIcsUrl;
  const { rawIcs, source, fetchedAt } = await fetchRawZoneCIcs({
    forceRefresh: options?.forceRefresh,
    calendarUrl,
  });

  return evaluateScheduleFromIcs(rawIcs, {
    targetDate: options?.targetDate,
    now: options?.now,
    calendarUrl,
    source,
    fetchedAt,
  });
}

export function resetIcsCacheForTests(): void {
  cachedIcs = null;
}
