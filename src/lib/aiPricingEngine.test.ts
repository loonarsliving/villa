import { describe, it, expect } from "vitest";

import { decideRateForDate, fixedCalendarPeriodFor, learnDiscountWindow, type DateDecisionInput, type PricingSettings } from "./aiPricingEngine";

/**
 * Tests for the pricing REASONING, not for Supabase plumbing.
 *
 * Every rule asserted here exists because its absence cost real money or
 * a real owner complaint -- the comments in aiPricingEngine.ts name the
 * incident behind each one. The point of this file is that the next
 * change to those rules fails here first, instead of failing live on
 * every OTA the way the 16/22/23 Sep ceiling push did.
 */

const settings: PricingSettings = {
  max_daily_movement_pct: 0.15,
  high_occupancy_threshold_pct: 70,
  high_occupancy_adjustment_pct: 0.15,
  low_occupancy_threshold_pct: 30,
  low_occupancy_adjustment_pct: -0.1,
};

// 2026-09-14 is a Monday, so the weekend surcharge stays out of the way
// unless a test deliberately asks for a Friday/Saturday.
const MONDAY = "2026-09-14";
const FRIDAY = "2026-09-18";

function decide(overrides: Partial<DateDecisionInput> = {}) {
  return decideRateForDate({
    targetDate: MONDAY,
    anchorRate: 650000,
    occupancyPct: 0,
    daysToArrival: 100,
    coldStart: false,
    period: null,
    competitorMedian: null,
    liveRate: null,
    marketTrend: null,
    marketSearchRelative: null,
    paceExpectedSold: null,
    unitsSoldNow: 0,
    settings,
    minRate: 600000,
    maxRate: 1000000,
    ...overrides,
  });
}

describe("anchor and weekend", () => {
  it("prices an ordinary empty weekday far out at exactly the base rate", () => {
    expect(decide().decided_rate).toBe(650000);
  });

  it("adds the weekend surcharge on a Friday", () => {
    expect(decide({ targetDate: FRIDAY }).decided_rate).toBe(750000);
  });

  it("is idempotent: feeding its own output back as the live rate changes nothing", () => {
    const first = decide({ liveRate: null });
    const second = decide({ liveRate: first.decided_rate });
    expect(second.decided_rate).toBe(first.decided_rate);
  });

  it("uses Standard's larger weekend surcharge so the weekend price holds when the weekday base is cut (owner 2026-09-16)", () => {
    const d = decide({ targetDate: FRIDAY, anchorRate: 550000, minRate: 550000, roomTypeCode: "standard" });
    expect(d.decided_rate).toBe(750000);
  });

  it("falls back to the Rp100.000 surcharge for a room type with no override", () => {
    const d = decide({ targetDate: FRIDAY, roomTypeCode: "sawah_view" });
    expect(d.decided_rate).toBe(750000);
  });
});

describe("lead time (SIGNAL 3)", () => {
  it("does NOT discount an empty date that is still months away", () => {
    const d = decide({ occupancyPct: 0, daysToArrival: 200 });
    expect(d.decided_rate).toBe(650000);
    expect(d.reason_codes).toContain("low_occupancy_too_early_to_discount");
  });

  it("discounts an empty date half way in the middle window", () => {
    const d = decide({ occupancyPct: 0, daysToArrival: 30 });
    expect(d.decided_rate).toBe(618000); // -5% = half of -10%
    expect(d.reason_codes).toContain("low_occupancy_partial_lead_time");
  });

  it("discounts an empty date in full close to arrival", () => {
    // min_rate lowered here so the discount itself is visible; the real
    // 600,000 floor is asserted separately below.
    const d = decide({ occupancyPct: 0, daysToArrival: 10, minRate: 400000 });
    expect(d.decided_rate).toBe(585000);
    expect(d.reason_codes).toContain("low_occupancy");
  });

  it("but the owner's floor still wins over the full discount", () => {
    const d = decide({ occupancyPct: 0, daysToArrival: 10 });
    expect(d.decided_rate).toBe(600000);
    expect(d.guardrail_status).toBe("clamped_min");
  });

  it("holds the discount entirely while booking history is too thin", () => {
    const d = decide({ occupancyPct: 0, daysToArrival: 3, coldStart: true });
    expect(d.decided_rate).toBe(650000);
    expect(d.reason_codes).toContain("cold_start_hold");
  });

  it("raises price on high occupancy at ANY lead time", () => {
    const far = decide({ occupancyPct: 90, daysToArrival: 300 });
    const near = decide({ occupancyPct: 90, daysToArrival: 2 });
    expect(far.decided_rate).toBe(748000);
    expect(near.decided_rate).toBe(748000);
  });
});

describe("low season (SIGNAL 1)", () => {
  const ramadan = { suggested_adjustment_pct: -0.1, created_by: "ai_low_season" };

  it("discounts a quiet period straight away, without waiting for pickup", () => {
    const d = decide({ period: ramadan, occupancyPct: 0, daysToArrival: 200, minRate: 400000 });
    // No lead-time discount that far out, but the trough itself applies.
    expect(d.decided_rate).toBe(585000);
    expect(d.reason_codes).toContain("low_season_discount");
  });

  it("withdraws the discount on a quiet-period date that is selling anyway", () => {
    // 50%: laku cukup untuk menarik diskon, tapi belum masuk tangga okupansi.
    const d = decide({ period: ramadan, occupancyPct: 50 });
    expect(d.decided_rate).toBe(650000);
    expect(d.reason_codes).toContain("low_season_discount_not_needed");
  });

  it("never prices a quiet period below the owner's floor", () => {
    const deep = { suggested_adjustment_pct: -0.2, created_by: "ai_low_season" };
    const d = decide({ period: deep, occupancyPct: 0, daysToArrival: 5, minRate: 600000 });
    expect(d.decided_rate).toBe(600000);
    expect(d.guardrail_status).toBe("clamped_min");
  });
});

describe("peaks still have to be earned", () => {
  const foundEvent = { suggested_adjustment_pct: 0.2, created_by: "ai_jogja_events_research" };
  const newYear = { suggested_adjustment_pct: 0.2, created_by: "ai_recurring_peak" };

  it("does not raise price for an AI-found event nobody has booked", () => {
    const d = decide({ period: foundEvent, occupancyPct: 0, daysToArrival: 60 });
    expect(d.decided_rate).toBe(650000);
    expect(d.reason_codes).toContain("event_demand_unproven");
  });

  it("raises price for a certain yearly peak months ahead", () => {
    const d = decide({ period: newYear, occupancyPct: 0, daysToArrival: 120 });
    expect(d.decided_rate).toBe(780000);
    expect(d.reason_codes).toContain("recurring_peak");
  });

  it("prices a peak as a peak when a trough overlaps it is not possible -- the caller picks the stronger period", () => {
    // pickPeriodForDate is what resolves the overlap; here we assert the
    // consequence: given the peak, the trough's discount never appears.
    const d = decide({ period: newYear, occupancyPct: 0 });
    expect(d.reason_codes).not.toContain("low_season_discount");
  });
});

describe("market interest (SIGNAL 2)", () => {
  // Sinyal ini masuk lewat penggabungan berbobot: okupansi selalu ikut
  // (bobot 0,60) walau usulannya 0, jadi usulan +3% dari minat pasar
  // (bobot 0,12) menjadi 0,12/0,72 x 3% = +0,5% pada harga akhir. Itu
  // memang disengaja -- ia mengukur seluruh Jogja, bukan villa kita.
  it("nudges price up when search interest is rising", () => {
    expect(decide({ marketTrend: "naik" }).decided_rate).toBe(653000);
  });

  it("nudges price down when search interest is falling", () => {
    expect(decide({ marketTrend: "turun" }).decided_rate).toBe(647000);
  });

  it("does nothing when the trend is flat or unknown", () => {
    expect(decide({ marketTrend: "stabil" }).decided_rate).toBe(650000);
    expect(decide({ marketTrend: null }).decided_rate).toBe(650000);
  });

  it("prefers the numeric monthly index over the qualitative trend", () => {
    // Keduanya menjawab pertanyaan yang sama, jadi tidak boleh dihitung dua
    // kali: kalau indeks berangka ada, ia yang dipakai.
    const d = decide({ marketSearchRelative: 0.4, marketTrend: "turun" });
    expect(d.reason_codes).toContain("market_search_high");
    expect(d.reason_codes).not.toContain("market_interest_down");
  });

  it("holds the market signal entirely during cold start", () => {
    const d = decide({ marketSearchRelative: 0.8, coldStart: true });
    expect(d.decided_rate).toBe(650000);
    expect(d.reason_codes).toContain("market_search_held_cold_start");
  });

  it("stays the smallest lever: it cannot outweigh a full occupancy move", () => {
    const trendOnly = decide({ marketTrend: "naik" }).decided_rate - 650000;
    const occupancyOnly = decide({ occupancyPct: 90 }).decided_rate - 650000;
    expect(Math.abs(trendOnly)).toBeLessThan(Math.abs(occupancyOnly));
  });
});

describe("pace (SIGNAL 4)", () => {
  it("lifts a date that is filling faster than comparable dates", () => {
    const d = decide({ paceExpectedSold: 1, unitsSoldNow: 2, minRate: 400000 });
    expect(d.reason_codes).toContain("pace_ahead");
    expect(d.decided_rate).toBeGreaterThan(650000);
  });

  it("eases a date that is filling slower than comparable dates", () => {
    const d = decide({ paceExpectedSold: 2, unitsSoldNow: 1, minRate: 400000 });
    expect(d.reason_codes).toContain("pace_behind");
    expect(d.decided_rate).toBeLessThan(650000);
  });

  it("ignores a difference too small to be anything but noise", () => {
    const d = decide({ paceExpectedSold: 10, unitsSoldNow: 11 });
    expect(d.reason_codes).not.toContain("pace_ahead");
    expect(d.decided_rate).toBe(650000);
  });

  it("does nothing at all when there is no comparable history", () => {
    expect(decide({ paceExpectedSold: null, unitsSoldNow: 5 }).decided_rate).toBe(650000);
  });

  it("is held during cold start, like the event uplift", () => {
    const d = decide({ paceExpectedSold: 1, unitsSoldNow: 3, coldStart: true });
    expect(d.decided_rate).toBe(650000);
    expect(d.reason_codes).toContain("pace_held_cold_start");
  });

  it("stays bounded even when a date sells ten times faster than normal", () => {
    const d = decide({ paceExpectedSold: 0.5, unitsSoldNow: 10 });
    // usulan pace dijepit ke +8%, lalu diencerkan bobotnya -> jauh di bawah
    // lonjakan yang pernah terjadi pada insiden 16/22/23 Sep.
    expect(d.decided_rate).toBeLessThanOrEqual(Math.round(650000 * 1.04));
  });
});

describe("signals only count when they have data", () => {
  it("with occupancy alone, the blend reproduces the old single-signal engine", () => {
    const d = decide({ occupancyPct: 90, paceExpectedSold: null, marketSearchRelative: null, marketTrend: null });
    expect(d.decided_rate).toBe(748000); // 650.000 x 1,15, persis seperti sebelum lapisan ini ada
  });
});

describe("competitor band is a cap, never a floor", () => {
  it("trims an uplift that runs past the market median", () => {
    const d = decide({ occupancyPct: 90, competitorMedian: 700000 });
    expect(d.decided_rate).toBe(700000);
    expect(d.reason_codes).toContain("competitor_market_cap");
  });

  it("never cuts below our own rate plan just because neighbours are cheap", () => {
    // The 2026-09-11 incident: a thin/cheap sample cut a real Saturday.
    const d = decide({ targetDate: FRIDAY, competitorMedian: 500000 });
    expect(d.decided_rate).toBe(750000);
  });

  it("does not cap a certain peak with an ordinary-night sample", () => {
    const newYear = { suggested_adjustment_pct: 0.2, created_by: "ai_recurring_peak" };
    const d = decide({ period: newYear, competitorMedian: 700000 });
    expect(d.decided_rate).toBe(780000);
  });

  it("still caps during a trough -- pricing under the neighbours is the intent", () => {
    const d = decide({ period: { suggested_adjustment_pct: -0.1, created_by: "ai_low_season" }, competitorMedian: 700000 });
    expect(d.decided_rate).toBe(585000 < 600000 ? 600000 : 585000);
  });
});

describe("guardrails", () => {
  it("never prices an empty date up close to arrival", () => {
    const d = decide({ occupancyPct: 0, daysToArrival: 3, liveRate: 620000, marketTrend: "naik" });
    expect(d.decided_rate).toBeLessThanOrEqual(620000);
  });

  it("clamps a lurch away from the anchor", () => {
    const d = decide({ occupancyPct: 90, liveRate: 500000, marketTrend: "naik", minRate: 400000 });
    expect(d.guardrail_status).toBe("clamped_movement");
    expect(d.decided_rate).toBe(575000);
  });

  it("does NOT clamp a correction back toward the anchor", () => {
    // Recovering a date stuck at the ceiling must not take three days.
    const d = decide({ liveRate: 1000000, occupancyPct: 0, daysToArrival: 100 });
    expect(d.decided_rate).toBe(650000);
    expect(d.guardrail_status).toBe("within_range");
  });

  it("respects max_rate above everything else", () => {
    const d = decide({ targetDate: FRIDAY, occupancyPct: 90, period: { suggested_adjustment_pct: 0.2, created_by: "ai_recurring_peak" }, marketTrend: "naik", maxRate: 800000 });
    expect(d.decided_rate).toBe(800000);
    expect(d.guardrail_status).toBe("clamped_max");
  });
});

describe("explanation", () => {
  it("explains every date in one readable sentence", () => {
    const d = decide({ occupancyPct: 0, daysToArrival: 10 });
    expect(d.reason_text).toContain("Harga dasar");
    expect(d.reason_text).toContain("didiskon penuh");
    expect(d.reason_text.endsWith(".")).toBe(true);
  });

  it("never claims a move the arithmetic did not make", () => {
    const flat = decide();
    expect(flat.reason_text).not.toContain("dinaikkan");
    expect(flat.reason_text).not.toContain("diturunkan karena");
    expect(flat.reason_text).not.toContain("didiskon");
  });
});

describe("pembulatan ke Rp1.000 (owner 2026-09-23)", () => {
  it("rounds every price to the nearest thousand", () => {
    const d = decide({ marketSearchRelative: 0.05 });
    expect(d.decided_rate % 1000).toBe(0);
  });

  it("never rounds below min_rate or above max_rate", () => {
    expect(decide({ occupancyPct: 0, daysToArrival: 5, minRate: 585400 }).decided_rate).toBe(585400);
    expect(decide({ occupancyPct: 100, maxRate: 700600 }).decided_rate).toBe(700600);
  });
});

describe("Natal-Tahun Baru dari kalender tetap (tidak bergantung riset AI)", () => {
  it("covers the nights of 24-31 Dec and 1 Jan, with New Year's Eve highest", () => {
    expect(fixedCalendarPeriodFor("2026-12-23")).toBeNull();
    expect(fixedCalendarPeriodFor("2026-12-24")?.suggested_adjustment_pct).toBe(0.2);
    expect(fixedCalendarPeriodFor("2026-12-31")?.suggested_adjustment_pct).toBe(0.4);
    expect(fixedCalendarPeriodFor("2027-01-01")?.suggested_adjustment_pct).toBe(0.2);
    expect(fixedCalendarPeriodFor("2027-01-02")).toBeNull();
  });

  it("prices New Year's Eve up in full with no bookings and ignores the ordinary-night competitor cap", () => {
    // 31 Des 2026 jatuh hari Kamis.
    const d = decide({ targetDate: "2026-12-31", anchorRate: 750000, period: fixedCalendarPeriodFor("2026-12-31"), competitorMedian: 700000, maxRate: null });
    expect(d.decided_rate).toBe(1050000);
    expect(d.reason_codes).toContain("new_years_eve_peak");
    expect(d.reason_codes).not.toContain("competitor_market_cap");
  });

  it("is still bounded by the daily movement clamp and max_rate", () => {
    const period = fixedCalendarPeriodFor("2026-12-31");
    expect(decide({ targetDate: "2026-12-31", anchorRate: 750000, period, liveRate: 750000, maxRate: null }).decided_rate).toBe(863000);
    expect(decide({ targetDate: "2026-12-31", anchorRate: 750000, period, maxRate: 1000000 }).decided_rate).toBe(1000000);
  });
});

describe("tangga okupansi", () => {
  it("raises price step by step between 50% and the high threshold", () => {
    // settings: tinggi 70% = +15%. 60% = separuh jalan = +7,5%.
    const d = decide({ occupancyPct: 60 });
    expect(d.decided_rate).toBe(699000);
    expect(d.reason_codes).toContain("occupancy_building");
  });

  it("does nothing at or below 50%", () => {
    expect(decide({ occupancyPct: 50 }).decided_rate).toBe(650000);
  });
});

describe("jendela diskon dipelajari dari booking sendiri", () => {
  const row = (lead: number) => ({ created_at: "2026-09-01T03:00:00Z", tgl_checkin: new Date(Date.parse("2026-09-01T00:00:00Z") + lead * 86400000).toISOString().slice(0, 10) });

  it("keeps the 14/45 defaults until there is enough history", () => {
    expect(learnDiscountWindow([row(3), row(5)])).toMatchObject({ fullDays: 14, halfDays: 45, learned: false });
  });

  it("uses the median and 75th percentile of the real booking window", () => {
    const rows = Array.from({ length: 21 }, (_, i) => row(i * 2)); // 0..40 hari
    expect(learnDiscountWindow(rows)).toMatchObject({ fullDays: 20, halfDays: 30, learned: true });
  });

  it("clamps so a few very early bookings cannot start discounts months ahead", () => {
    const rows = Array.from({ length: 21 }, () => row(170));
    expect(learnDiscountWindow(rows)).toMatchObject({ fullDays: 30, halfDays: 90 });
  });

  it("changes when a discount starts", () => {
    const w = { fullDays: 7, halfDays: 21 };
    expect(decide({ occupancyPct: 0, daysToArrival: 10, discountWindow: w }).reason_codes).toContain("low_occupancy_partial_lead_time");
    expect(decide({ occupancyPct: 0, daysToArrival: 30, discountWindow: w }).reason_codes).toContain("low_occupancy_too_early_to_discount");
  });
});
