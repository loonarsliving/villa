import { describe, expect, it } from "vitest";

import { resolveAiBridgeConfig } from "./aiBridge";

const WA = { base_url: "https://living.haluoleo.id", secret: "shared" };

describe("resolveAiBridgeConfig", () => {
  it("uses ai_bridge.base_url, never the WhatsApp bridge address", () => {
    const cfg = resolveAiBridgeConfig({ base_url: "https://mkh.haluoleo.id/" }, WA);
    expect(cfg.baseUrl).toBe("https://mkh.haluoleo.id");
  });

  it("falls back to the shared vercel_bridge secret when ai_bridge has none", () => {
    expect(resolveAiBridgeConfig({ base_url: "https://mkh.haluoleo.id" }, WA).secret).toBe("shared");
  });

  it("prefers ai_bridge's own secret", () => {
    expect(resolveAiBridgeConfig({ base_url: "https://mkh.haluoleo.id", secret: "own" }, WA).secret).toBe("own");
  });

  it("refuses to run without ai_bridge rather than borrowing vercel_bridge.base_url", () => {
    expect(() => resolveAiBridgeConfig(undefined, WA)).toThrow(/ai_bridge\.base_url/);
    expect(() => resolveAiBridgeConfig({ base_url: "  " }, WA)).toThrow(/ai_bridge\.base_url/);
  });

  it("refuses to run without any secret", () => {
    expect(() => resolveAiBridgeConfig({ base_url: "https://mkh.haluoleo.id" }, { base_url: "x" })).toThrow(/secret/);
  });
});
