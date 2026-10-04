import { afterEach, describe, expect, it, vi } from "vitest";
import i18n, { languages, readLanguagePreference } from "../../src/i18n";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.removeItem("beacon-language");
});

describe("language preferences", () => {
  it("offers only the two supported language choices", () => {
    expect(languages.map(({ code }) => code).sort()).toEqual(["en", "lt"]);
  });

  it("defaults to Lithuanian without a saved choice", () => {
    localStorage.removeItem("beacon-language");
    expect(readLanguagePreference()).toBe("lt");
  });

  it.each(["en", "lt"])("preserves a supported saved language %s on initialization", async language => {
    const setItem = vi.fn();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => key === "beacon-language" ? language : null,
      setItem,
      removeItem() {},
    });
    try {
      vi.resetModules();
      const restored = await import("../../src/i18n");
      expect(restored.readLanguagePreference()).toBe(language);
      expect(restored.default.resolvedLanguage).toBe(language);
      expect(document.documentElement.lang).toBe(language);
      expect(document.documentElement.dir).toBe("ltr");
      expect(setItem).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each(["fr", "sv", "unknown", "constructor", "", "../fr"])("ignores unsupported saved language %j", value => {
    localStorage.setItem("beacon-language", value);
    expect(readLanguagePreference()).toBe("lt");
  });

  it("still initializes and changes language when browser storage is unavailable", async () => {
    vi.stubGlobal("localStorage", {
      getItem() { throw new Error("blocked"); },
      setItem() { throw new Error("blocked"); },
      removeItem() {},
    });
    try {
      vi.resetModules();
      const fresh = await import("../../src/i18n");
      expect(fresh.readLanguagePreference()).toBe("lt");
      expect(fresh.default.resolvedLanguage).toBe("lt");
      expect(document.documentElement.lang).toBe("lt");
      expect(document.documentElement.dir).toBe("ltr");
      await fresh.default.changeLanguage("en");
      expect(fresh.default.resolvedLanguage).toBe("en");
      expect(document.documentElement.lang).toBe("en");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("does not persist an implicit initial choice, including a stale removed language", async () => {
    const store = new Map([["beacon-language", "fr"]]);
    const setItem = vi.fn((key: string, value: string) => { store.set(key, value); });
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem,
      removeItem: (key: string) => { store.delete(key); },
    });
    try {
      vi.resetModules();
      const fresh = await import("../../src/i18n");
      expect(fresh.default.resolvedLanguage).toBe("lt");
      expect(document.documentElement.lang).toBe("lt");
      expect(setItem).not.toHaveBeenCalled();
      expect(store.get("beacon-language")).toBe("fr");
      await fresh.default.changeLanguage("en");
      expect(store.get("beacon-language")).toBe("en");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("persists only the language preference and updates document metadata", async () => {
    localStorage.setItem("beacon-region", "YVR");
    await i18n.changeLanguage("lt");
    expect(localStorage.getItem("beacon-language")).toBe("lt");
    expect(localStorage.getItem("beacon-region")).toBe("YVR");
    await i18n.changeLanguage("en");
    expect(document.documentElement.lang).toBe("en");
    localStorage.removeItem("beacon-region");
  });

  it("uses the configured fallback for missing and empty resources", async () => {
    i18n.addResource("en", "translation", "fallbackTest", "Fallback value");
    await i18n.changeLanguage("lt");
    expect(i18n.t("fallbackTest")).toBe("Fallback value");
    i18n.addResource("lt", "translation", "fallbackTest", "");
    expect(i18n.t("fallbackTest")).toBe("Fallback value");
  });
});
