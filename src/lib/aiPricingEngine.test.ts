import { describe, it, expect } from "vitest";

import { decideRateForDate, type DateDecisionInput, type PricingSettings } from "./aiPricingEngine";

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
});

describe("lead time (SIGNAL 3)", () => {
  it("does NOT discount an empty date that is still months away", () => {
    const d = decide({ occupancyPct: 0, daysToArrival: 200 });
    expect(d.decided_rate).toBe(650000);
    expect(d.reason_codes).toContain("low_occupancy_too_early_to_discount");
  });

  it("discounts an empty date half way in the middle window", () => {
    const d = decide({ occupancyPct: 0, daysToArrival: 30 });
    expect(d.decided_rate).toBe(617500); // -5% = half of -10%
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
    expect(far.decided_rate).toBe(747500);
    expect(near.decided_rate).toBe(747500);
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
    const d = decide({ period: ramadan, occupancyPct: 60 });
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
  it("nudges price up when search interest is rising", () => {
    expect(decide({ marketTrend: "naik" }).decided_rate).toBe(669500);
  });

  it("nudges price down when search interest is falling", () => {
    expect(decide({ marketTrend: "turun" }).decided_rate).toBe(630500);
  });

  it("does nothing when the trend is flat or unknown", () => {
    expect(decide({ marketTrend: "stabil" }).decided_rate).toBe(650000);
    expect(decide({ marketTrend: null }).decided_rate).toBe(650000);
  });

  it("stays the smallest lever: it cannot outweigh a full occupancy move", () => {
    const trendOnly = decide({ marketTrend: "naik" }).decided_rate - 650000;
    const occupancyOnly = decide({ occupancyPct: 90 }).decided_rate - 650000;
    expect(Math.abs(trendOnly)).toBeLessThan(Math.abs(occupancyOnly));
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
