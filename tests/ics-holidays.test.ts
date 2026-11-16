import assert from "node:assert/strict";
import test from "node:test";
import { getParisNowParts } from "../src/lib/date";
import {
  buildHolidayPeriods,
  evaluateScheduleFromIcs,
  evaluateSwitchForDate,
  findNextTransition,
} from "../src/lib/holidays";
import { parseIcsEvents } from "../src/lib/ics";

const SAMPLE_ZONE_C_ICS = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Test Zone C//FR",
  // Toussaint 2026 duplicated across two academies & folded summary
  "BEGIN:VEVENT",
  "UID:toussaint-paris-2026",
  "DTSTART;VALUE=DATE:20261017",
  "DTEND;VALUE=DATE:20261102",
  "SUMMARY:Vacances de la",
  "  Toussaint",
  "BEGIN:VALARM",
  "ACTION:DISPLAY",
  "SUMMARY:Ignored Alarm Summary",
  "END:VALARM",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:toussaint-creteil-2026",
  "DTSTART;VALUE=DATE:20261017",
  "DTEND;VALUE=DATE:20261102",
  "SUMMARY:Vacances de la Toussaint",
  "END:VEVENT",
  // Rentrée & Prérentrée must be ignored
  "BEGIN:VEVENT",
  "UID:rentree-2026",
  "DTSTART;VALUE=DATE:20260901",
  "DTEND;VALUE=DATE:20260902",
  "SUMMARY:Rentrée scolaire des élèves",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:prerentrée-2026",
  "DTSTART;VALUE=DATE:20260831",
  "DTEND;VALUE=DATE:20260901",
  "SUMMARY:Prérentrée des enseignants",
  "END:VEVENT",
  // UTC midnight-in-Paris timestamps (Noël 2026: Sat Dec 19 -> Mon Jan 4, CET = UTC+1)
  "BEGIN:VEVENT",
  "UID:noel-2026",
  "DTSTART:20261218T230000Z",
  "DTEND:20270103T230000Z",
  "SUMMARY:Vacances de Noël",
  "END:VEVENT",
  // Pont de l'Ascension 2027 (Thu May 6 -> Mon May 10)
  "BEGIN:VEVENT",
  "UID:ascension-2027",
  "DTSTART;VALUE=DATE:20270506",
  "DTEND;VALUE=DATE:20270510",
  "SUMMARY:Pont de l'Ascension",
  "END:VEVENT",
  // Cancelled holiday event must be ignored
  "BEGIN:VEVENT",
  "UID:cancelled-2027",
  "STATUS:CANCELLED",
  "DTSTART;VALUE=DATE:20270601",
  "DTEND;VALUE=DATE:20270605",
  "SUMMARY:Vacances annulées",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

test("parseIcsEvents handles folded lines, nested VALARM, UTC-to-Paris dates, and cancelled events", () => {
  const events = parseIcsEvents(SAMPLE_ZONE_C_ICS);
  assert.equal(events.length, 6);

  const toussaint = events.find((e) => e.uid === "toussaint-paris-2026");
  assert.ok(toussaint);
  assert.equal(toussaint.summary, "Vacances de la Toussaint");
  assert.equal(toussaint.startDate, "2026-10-17");
  assert.equal(toussaint.endDate, "2026-11-02");

  const noel = events.find((e) => e.uid === "noel-2026");
  assert.ok(noel);
  assert.equal(noel.startDate, "2026-12-19");
  assert.equal(noel.endDate, "2027-01-04");

  assert.equal(
    events.some((e) => e.uid === "cancelled-2027"),
    false,
  );
});

test("buildHolidayPeriods merges duplicate academies and excludes rentrée", () => {
  const events = parseIcsEvents(SAMPLE_ZONE_C_ICS);
  const { periods, ignoredEvents } = buildHolidayPeriods(events);

  assert.equal(ignoredEvents.length, 2);
  assert.equal(periods.length, 3);

  assert.deepEqual(periods[0], {
    id: "2026-10-17_2026-11-02",
    title: "Vacances de la Toussaint",
    summaries: ["Vacances de la Toussaint"],
    startDate: "2026-10-17",
    endDate: "2026-11-02",
    firstSaturday: "2026-10-17",
    firstSunday: "2026-10-18",
  });

  assert.deepEqual(periods[1], {
    id: "2026-12-19_2027-01-04",
    title: "Vacances de Noël",
    summaries: ["Vacances de Noël"],
    startDate: "2026-12-19",
    endDate: "2027-01-04",
    firstSaturday: "2026-12-19",
    firstSunday: "2026-12-20",
  });

  assert.deepEqual(periods[2], {
    id: "2027-05-06_2027-05-10",
    title: "Pont de l'Ascension",
    summaries: ["Pont de l'Ascension"],
    startDate: "2027-05-06",
    endDate: "2027-05-10",
    firstSaturday: "2027-05-08",
    firstSunday: "2027-05-09",
  });
});

test("evaluateSwitchForDate enforces outside-holidays OFF, 1st Sat/Sun OFF, rest of holiday ON", () => {
  const { periods } = buildHolidayPeriods(parseIcsEvents(SAMPLE_ZONE_C_ICS));

  // Rentrée & normal days must be OFF
  assert.equal(evaluateSwitchForDate(periods, "2026-09-01").isOn, false);
  assert.equal(evaluateSwitchForDate(periods, "2026-10-16").isOn, false);

  // Toussaint: 1st Sat & Sun OFF
  const sat1 = evaluateSwitchForDate(periods, "2026-10-17");
  assert.equal(sat1.isOn, false);
  assert.equal(sat1.reason, "first_saturday_excluded");

  const sun1 = evaluateSwitchForDate(periods, "2026-10-18");
  assert.equal(sun1.isOn, false);
  assert.equal(sun1.reason, "first_sunday_excluded");

  // Rest of Toussaint including 2nd & 3rd weekends must be ON
  assert.equal(evaluateSwitchForDate(periods, "2026-10-19").isOn, true);
  assert.equal(evaluateSwitchForDate(periods, "2026-10-24").isOn, true);
  assert.equal(evaluateSwitchForDate(periods, "2026-10-25").isOn, true);
  assert.equal(evaluateSwitchForDate(periods, "2026-10-31").isOn, true);
  assert.equal(evaluateSwitchForDate(periods, "2026-11-01").isOn, true);

  // School resumes Monday Nov 2 -> OFF
  assert.equal(evaluateSwitchForDate(periods, "2026-11-02").isOn, false);

  // Pont de l'Ascension: Thu & Fri ON, Sat & Sun OFF, Mon OFF
  assert.equal(evaluateSwitchForDate(periods, "2027-05-05").isOn, false);
  assert.equal(evaluateSwitchForDate(periods, "2027-05-06").isOn, true);
  assert.equal(evaluateSwitchForDate(periods, "2027-05-07").isOn, true);
  assert.equal(evaluateSwitchForDate(periods, "2027-05-08").isOn, false);
  assert.equal(evaluateSwitchForDate(periods, "2027-05-09").isOn, false);
  assert.equal(evaluateSwitchForDate(periods, "2027-05-10").isOn, false);
});

test("evaluateScheduleFromIcs switches cleanly at 00:00 Europe/Paris across DST boundaries", () => {
  // 2026-10-18 23:59:59 CEST = 2026-10-18T21:59:59Z -> still Sunday (OFF)
  const beforeMonday = new Date("2026-10-18T21:59:59Z");
  const snapBefore = evaluateScheduleFromIcs(SAMPLE_ZONE_C_ICS, { now: beforeMonday });
  assert.equal(snapBefore.parisNow.date, "2026-10-18");
  assert.equal(snapBefore.current.isOn, false);

  // 2026-10-19 00:00:00 CEST = 2026-10-18T22:00:00Z -> Monday (ON)
  const atMonday = new Date("2026-10-18T22:00:00Z");
  const snapAtMonday = evaluateScheduleFromIcs(SAMPLE_ZONE_C_ICS, { now: atMonday });
  assert.equal(snapAtMonday.parisNow.date, "2026-10-19");
  assert.equal(snapAtMonday.current.isOn, true);
  assert.equal(snapAtMonday.yesterday.isOn, false);

  // After DST fallback (CET = UTC+1): 2026-11-01T22:59:59Z = 2026-11-01 23:59:59 CET -> ON
  const endSunday = new Date("2026-11-01T22:59:59Z");
  assert.equal(getParisNowParts(endSunday).ymd, "2026-11-01");
  assert.equal(evaluateScheduleFromIcs(SAMPLE_ZONE_C_ICS, { now: endSunday }).current.isOn, true);

  // 2026-11-01T23:00:00Z = 2026-11-02 00:00:00 CET -> Monday back to school (OFF)
  const backToSchool = new Date("2026-11-01T23:00:00Z");
  const snapBack = evaluateScheduleFromIcs(SAMPLE_ZONE_C_ICS, { now: backToSchool });
  assert.equal(snapBack.parisNow.date, "2026-11-02");
  assert.equal(snapBack.current.isOn, false);
  assert.equal(snapBack.yesterday.isOn, true);
});

test("findNextTransition locates next ON and OFF dates", () => {
  const { periods } = buildHolidayPeriods(parseIcsEvents(SAMPLE_ZONE_C_ICS));

  const nextFromOct17 = findNextTransition(periods, "2026-10-17");
  assert.ok(nextFromOct17);
  assert.equal(nextFromOct17.date, "2026-10-19");
  assert.equal(nextFromOct17.nextState, true);

  const nextFromOct20 = findNextTransition(periods, "2026-10-20");
  assert.ok(nextFromOct20);
  assert.equal(nextFromOct20.date, "2026-11-02");
  assert.equal(nextFromOct20.nextState, false);
});
