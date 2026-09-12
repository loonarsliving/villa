import { describe, expect, it } from "vitest";

import { collapseRateIntervals } from "./cloudbedsApi";

/**
 * Guards the collapse that makes a 365-day push fit: Cloudbeds silently
 * drops form fields past PHP's max_input_vars = 1000, which is how a
 * full-year push came back as "The endDate parameter value is missing"
 * with no indication that anything had been truncated. A bug here would
 * publish a wrong price to every OTA, so the edges are pinned down.
 */
describe("collapseRateIntervals", () => {
  it("merges consecutive dates at the same rate into one inclusive interval", () => {
    expect(
      collapseRateIntervals([
        { date: "2026-09-14", rate: 650000 },
        { date: "2026-09-15", rate: 650000 },
        { date: "2026-09-16", rate: 650000 },
      ]),
    ).toEqual([{ startDate: "2026-09-14", endDate: "2026-09-16", rate: 650000 }]);
  });

  it("starts a new interval when the rate changes", () => {
    expect(
      collapseRateIntervals([
        { date: "2026-09-17", rate: 650000 },
        { date: "2026-09-18", rate: 750000 },
        { date: "2026-09-19", rate: 750000 },
        { date: "2026-09-20", rate: 650000 },
      ]),
    ).toEqual([
      { startDate: "2026-09-17", endDate: "2026-09-17", rate: 650000 },
      { startDate: "2026-09-18", endDate: "2026-09-19", rate: 750000 },
      { startDate: "2026-09-20", endDate: "2026-09-20", rate: 650000 },
    ]);
  });

  it("never bridges a gap in the dates, even at the same rate", () => {
    // A missing day must stay missing: merging across it would publish a
    // price for a date the engine never actually decided.
    expect(
      collapseRateIntervals([
        { date: "2026-09-14", rate: 650000 },
        { date: "2026-09-16", rate: 650000 },
      ]),
    ).toEqual([
      { startDate: "2026-09-14", endDate: "2026-09-14", rate: 650000 },
      { startDate: "2026-09-16", endDate: "2026-09-16", rate: 650000 },
    ]);
  });

  it("merges across a month boundary", () => {
    expect(
      collapseRateIntervals([
        { date: "2026-09-30", rate: 650000 },
        { date: "2026-10-01", rate: 650000 },
      ]),
    ).toEqual([{ startDate: "2026-09-30", endDate: "2026-10-01", rate: 650000 }]);
  });

  it("returns nothing for no decisions", () => {
    expect(collapseRateIntervals([])).toEqual([]);
  });

  it("keeps a year of weekday/weekend pricing well under the batch limit", () => {
    const decisions: { date: string; rate: number }[] = [];
    for (let i = 0; i < 365; i++) {
      const d = new Date(Date.UTC(2026, 8, 12) + i * 86400000);
      const dow = d.getUTCDay();
      decisions.push({ date: d.toISOString().slice(0, 10), rate: dow === 5 || dow === 6 ? 750000 : 650000 });
    }
    const intervals = collapseRateIntervals(decisions);
    // ~105 runs, and every date still covered exactly once.
    expect(intervals.length).toBeLessThan(120);
    const covered = intervals.reduce((n, iv) => n + Math.round((Date.parse(`${iv.endDate}T00:00:00Z`) - Date.parse(`${iv.startDate}T00:00:00Z`)) / 86400000) + 1, 0);
    expect(covered).toBe(365);
  });
});
