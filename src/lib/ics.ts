import { PARIS_TIMEZONE } from "./config";
import { addDaysYmd, compareYmd, dateToZonedParts, formatYmd, parseYmd } from "./date";

export interface ParsedIcsEvent {
  uid: string;
  summary: string;
  description: string;
  location: string;
  startDate: string; // inclusive YYYY-MM-DD in Europe/Paris
  endDate: string; // exclusive YYYY-MM-DD in Europe/Paris
}

interface ParsedProperty {
  name: string;
  params: Record<string, string>;
  value: string;
}

interface RawVEvent {
  uid?: string;
  summary?: string;
  description?: string;
  location?: string;
  status?: string;
  dtstart?: ParsedProperty;
  dtend?: ParsedProperty;
}

const ICS_DATE_ONLY = /^(\d{4})(\d{2})(\d{2})$/;
const ICS_DATE_TIME = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/;

/**
 * Unfolds RFC 5545 folded lines (CRLF/LF followed by a single space or horizontal tab).
 */
export function unfoldIcsLines(rawText: string): string[] {
  const normalized = rawText.replace(/^\uFEFF/, "").replace(/\r?\n[ \t]/g, "");
  return normalized.split(/\r?\n/).filter((line) => line.length > 0);
}

function unescapeIcsText(value: string): string {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

function parseIcsPropertyLine(line: string): ParsedProperty | null {
  // Split at the first unquoted colon separating name/params from value.
  let inQuotes = false;
  let colonIdx = -1;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ":" && !inQuotes) {
      colonIdx = i;
      break;
    }
  }
  if (colonIdx <= 0) {
    return null;
  }

  const head = line.slice(0, colonIdx);
  const value = line.slice(colonIdx + 1);
  const segments = splitSemicolonOutsideQuotes(head);
  const name = (segments[0] || "").trim().toUpperCase();
  const params: Record<string, string> = {};

  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i];
    const eqIdx = seg.indexOf("=");
    if (eqIdx > 0) {
      const pName = seg.slice(0, eqIdx).trim().toUpperCase();
      let pVal = seg.slice(eqIdx + 1).trim();
      if (pVal.startsWith('"') && pVal.endsWith('"') && pVal.length >= 2) {
        pVal = pVal.slice(1, -1);
      }
      params[pName] = pVal;
    }
  }

  return { name, params, value: value.trim() };
}

function splitSemicolonOutsideQuotes(input: string): string[] {
  const parts: string[] = [];
  let inQuotes = false;
  let start = 0;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ";" && !inQuotes) {
      parts.push(input.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(input.slice(start));
  return parts;
}

interface ResolvedBoundary {
  ymd: string;
  isDateOnly: boolean;
  hour: number;
  minute: number;
  second: number;
}

function resolveBoundaryToParis(prop: ParsedProperty): ResolvedBoundary | null {
  const val = prop.value;
  const dateOnlyMatch = ICS_DATE_ONLY.exec(val);
  if (dateOnlyMatch || prop.params.VALUE?.toUpperCase() === "DATE") {
    if (!dateOnlyMatch) return null;
    const ymd = formatYmd(
      Number(dateOnlyMatch[1]),
      Number(dateOnlyMatch[2]),
      Number(dateOnlyMatch[3]),
    );
    parseYmd(ymd);
    return { ymd, isDateOnly: true, hour: 0, minute: 0, second: 0 };
  }

  const dtMatch = ICS_DATE_TIME.exec(val);
  if (!dtMatch) {
    return null;
  }

  const year = Number(dtMatch[1]);
  const month = Number(dtMatch[2]);
  const day = Number(dtMatch[3]);
  const hour = Number(dtMatch[4]);
  const minute = Number(dtMatch[5]);
  const second = Number(dtMatch[6]);
  const isUtc = dtMatch[7] === "Z";

  if (isUtc) {
    const instant = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    const paris = dateToZonedParts(instant, PARIS_TIMEZONE);
    return {
      ymd: paris.ymd,
      isDateOnly: false,
      hour: paris.hour,
      minute: paris.minute,
      second: paris.second,
    };
  }

  const tzid = prop.params.TZID;
  if (tzid && tzid !== PARIS_TIMEZONE && tzid.toUpperCase() !== "UTC") {
    try {
      // Interpret floating wall-clock in TZID approximately via Intl if it's a valid IANA zone.
      const approxUtc = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
      const tzParts = dateToZonedParts(approxUtc, tzid);
      const approxLocalAsUtc = Date.UTC(
        tzParts.year,
        tzParts.month - 1,
        tzParts.day,
        tzParts.hour,
        tzParts.minute,
        tzParts.second,
      );
      const targetLocalAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
      const offsetMs = approxLocalAsUtc - approxUtc.getTime();
      const instant = new Date(targetLocalAsUtc - offsetMs);
      const paris = dateToZonedParts(instant, PARIS_TIMEZONE);
      return {
        ymd: paris.ymd,
        isDateOnly: false,
        hour: paris.hour,
        minute: paris.minute,
        second: paris.second,
      };
    } catch {
      // Fall back to local Europe/Paris calendar interpretation for non-IANA TZIDs.
    }
  }

  const ymd = formatYmd(year, month, day);
  parseYmd(ymd);
  return { ymd, isDateOnly: false, hour, minute, second };
}

function resolveEndDateExclusive(
  startDate: string,
  endBoundary: ResolvedBoundary | null,
): string {
  if (!endBoundary) {
    return addDaysYmd(startDate, 1);
  }

  let endDate: string;
  if (endBoundary.isDateOnly) {
    endDate = endBoundary.ymd;
  } else if (endBoundary.hour < 6) {
    // Midnight (00:00:00) or early-AM UTC->Paris shifted midnight acts as an exclusive boundary.
    endDate = endBoundary.ymd;
  } else {
    // Daytime or 23:59:59 local end includes that calendar day.
    endDate = addDaysYmd(endBoundary.ymd, 1);
  }

  if (compareYmd(endDate, startDate) <= 0) {
    return addDaysYmd(startDate, 1);
  }
  return endDate;
}

/**
 * Parses an iCalendar (.ics) string into VEVENT records mapped to Europe/Paris calendar dates.
 */
export function parseIcsEvents(rawIcs: string): ParsedIcsEvent[] {
  const lines = unfoldIcsLines(rawIcs);
  const events: ParsedIcsEvent[] = [];

  let inEvent = false;
  let nestedDepth = 0;
  let current: RawVEvent | null = null;

  for (const line of lines) {
    const upper = line.toUpperCase();
    if (upper === "BEGIN:VEVENT") {
      inEvent = true;
      nestedDepth = 0;
      current = {};
      continue;
    }
    if (upper === "END:VEVENT") {
      if (inEvent && current && current.status?.toUpperCase() !== "CANCELLED" && current.dtstart) {
        const startBoundary = resolveBoundaryToParis(current.dtstart);
        if (startBoundary) {
          const endBoundary = current.dtend ? resolveBoundaryToParis(current.dtend) : null;
          const endDate = resolveEndDateExclusive(startBoundary.ymd, endBoundary);
          events.push({
            uid: current.uid || `${startBoundary.ymd}-${current.summary || "event"}`,
            summary: current.summary || "",
            description: current.description || "",
            location: current.location || "",
            startDate: startBoundary.ymd,
            endDate,
          });
        }
      }
      inEvent = false;
      nestedDepth = 0;
      current = null;
      continue;
    }

    if (!inEvent || !current) {
      continue;
    }

    if (upper.startsWith("BEGIN:")) {
      nestedDepth += 1;
      continue;
    }
    if (upper.startsWith("END:")) {
      nestedDepth = Math.max(0, nestedDepth - 1);
      continue;
    }
    if (nestedDepth > 0) {
      // Ignore nested VALARM or subcomponent properties.
      continue;
    }

    const prop = parseIcsPropertyLine(line);
    if (!prop) {
      continue;
    }

    switch (prop.name) {
      case "UID":
        current.uid = unescapeIcsText(prop.value);
        break;
      case "SUMMARY":
        current.summary = unescapeIcsText(prop.value);
        break;
      case "DESCRIPTION":
        current.description = unescapeIcsText(prop.value);
        break;
      case "LOCATION":
        current.location = unescapeIcsText(prop.value);
        break;
      case "STATUS":
        current.status = prop.value.trim();
        break;
      case "DTSTART":
        current.dtstart = prop;
        break;
      case "DTEND":
        current.dtend = prop;
        break;
    }
  }

  return events;
}
