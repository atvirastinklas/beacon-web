import { describe, expect, it, vi } from "vitest";
import i18n, { languages, readLanguagePreference } from "../../src/i18n";
import english from "../../src/i18n/locales/en.json";
import lithuanian from "../../src/i18n/locales/lt.json";

function flatten(catalog: Record<string, unknown>, prefix = ""): Record<string, unknown> {
  return Object.fromEntries(Object.entries(catalog).flatMap(([key, value]) => {
    const path = `${prefix}${key}`;
    return value !== null && typeof value === "object"
      ? Object.entries(flatten(value as Record<string, unknown>, `${path}.`))
      : [[path, value]];
  }));
}

const source = flatten(english.translation);
const translated = flatten(lithuanian.translation);
const pluralGroups = Object.keys(source).filter((key) => key.endsWith("_one"))
  .map((key) => key.slice(0, -"_one".length));
const pluralCategories = ["one", "few", "many", "other"];
const placeholders = (value: string) => [...value.matchAll(/{{\s*([^{}]+?)\s*}}/g)]
  .map((match) => match[1]).sort();

describe("Lithuanian catalog", () => {
  it("is automatically discovered under its native name", () => {
    expect(languages).toContainEqual({ code: "lt", name: "Lietuvių" });
    expect(i18n.t("tabs.Packets", { lng: "lt" })).toBe("Paketai");
    expect(i18n.t("tabs.Map", { lng: "lt" })).toBe("Žemėlapis");
    expect(i18n.t("nodeTypes.repeater", { lng: "lt" })).toBe("Retransliatorius");
  });

  it("covers every English key and all Lithuanian plural categories without unrelated keys", () => {
    const expectedKeys = new Set([
      ...Object.keys(source),
      ...pluralGroups.flatMap((group) => pluralCategories.map((category) => `${group}_${category}`)),
    ]);
    expect(Object.keys(translated).sort()).toEqual([...expectedKeys].sort());
  });

  it("has nonempty plain-text translations with matching interpolation placeholders", () => {
    for (const [key, value] of Object.entries(translated)) {
      expect(typeof value, key).toBe("string");
      expect((value as string).trim(), key).not.toBe("");
      expect(value, key).not.toMatch(/<\/?[a-z][^>]*>/i);
      // English has no few/many forms; these use the corresponding other form's placeholders.
      const sourceKey = key in source ? key : key.replace(/_(few|many)$/, "_other");
      expect(placeholders(value as string), key).toEqual(placeholders(source[sourceKey] as string));
    }
  });

  it.each([
    [0, "0 regionų", "0 kaimynų"],
    [1, "1 regionas", "1 kaimynas"],
    [2, "2 regionai", "2 kaimynai"],
    [10, "10 regionų", "10 kaimynų"],
    [11, "11 regionų", "11 kaimynų"],
    [21, "21 regionas", "21 kaimynas"],
    [22, "22 regionai", "22 kaimynai"],
    [1.5, "1.5 regiono", "1,5 kaimyno"],
  ])("resolves Lithuanian plurals for %s, including separately formatted values", (count, regions, neighbors) => {
    expect(i18n.t("region.count", { lng: "lt", count })).toBe(regions);
    expect(i18n.t("nodes.neighbors", {
      lng: "lt", count, formatted: String(count).replace(".", ","),
    })).toBe(neighbors);
  });

  it("interpolates whole phrases and retains the count-neutral heard-once translation", () => {
    expect(i18n.t("connection.rateLimited", { lng: "lt", seconds: 5 })).toBe("UŽKLAUSŲ RIBOJIMAS 5 s");
    expect(i18n.t("timestamp.ago", { lng: "lt", duration: "5 min." })).toBe("prieš 5 min.");
    expect(i18n.t("mesh.obs", { lng: "lt", value: "1,2k" })).toBe("1,2k steb.");
    // Lithuanian one also covers 21; English's one form intentionally has no count placeholder.
    expect(i18n.t("investigation.heardTimes", { lng: "lt", count: 21 })).toBe("Užfiksuota");
  });

  it("persists and restores Lithuanian on initialization with the correct document language", async () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    });
    try {
      await i18n.changeLanguage("lt");
      expect(localStorage.getItem("beacon-language")).toBe("lt");
      expect(readLanguagePreference()).toBe("lt");
      expect(document.documentElement.lang).toBe("lt");
      expect(document.documentElement.dir).toBe("ltr");

      vi.resetModules();
      const restored = (await import("../../src/i18n")).default;
      expect(restored.resolvedLanguage).toBe("lt");
      expect(restored.t("language.label")).toBe("Kalba");
      expect(document.documentElement.lang).toBe("lt");
      expect(document.documentElement.dir).toBe("ltr");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
