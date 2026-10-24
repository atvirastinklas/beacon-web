import { describe, expect, it } from "vitest";
import { DEFAULT_CONTACT_SETTINGS, meshlogContactState, normalizeContactSettings } from "../../../src/features/meshlog/contact-settings";
import type { MeshlogContact } from "../../../src/features/meshlog/types";
import { heardAt, liveNodeDetail } from "./live-fixtures";

const day = 86_400_000;
const contact: MeshlogContact = { id: "node", name: "Node", kind: "repeater", position: null, heard: "now", firstSeen: "—", heardAt };
const settings = { ...DEFAULT_CONTACT_SETTINGS };

describe("real-data contact settings", () => {
  it("uses the reference defaults with days rather than invented advert intervals", () => {
    expect(normalizeContactSettings({})).toEqual({ expiredAfterDays: 3, veryExpiredAfterDays: 7,
      hideAfterDays: 21, timeWarnings: true, clockWarningAfterMinutes: 30, locationWarnings: true });
    expect(normalizeContactSettings({ timeWarnings: false, locationWarnings: false })).toMatchObject({ timeWarnings: false, locationWarnings: false });
  });

  it("normalizes nonfinite/negative values and keeps age thresholds ordered", () => {
    expect(normalizeContactSettings({ expiredAfterDays: NaN, veryExpiredAfterDays: Infinity, hideAfterDays: -1,
      clockWarningAfterMinutes: -20 })).toMatchObject({ expiredAfterDays: 3, veryExpiredAfterDays: 7, hideAfterDays: 7, clockWarningAfterMinutes: 1 });
    expect(normalizeContactSettings({ expiredAfterDays: 10.9, veryExpiredAfterDays: 2, hideAfterDays: 1 }))
      .toMatchObject({ expiredAfterDays: 10, veryExpiredAfterDays: 10, hideAfterDays: 10 });
  });

  it.each([
    [0, "fresh", false], [3 * day - 1, "fresh", false], [3 * day, "expired", false],
    [7 * day - 1, "expired", false], [7 * day, "veryExpired", false],
    [21 * day - 1, "veryExpired", false], [21 * day, "veryExpired", true],
  ] as const)("classifies age %i ms at exact warning/hide boundaries", (elapsed, age, hidden) => {
    expect(meshlogContactState(contact, settings, heardAt + elapsed)).toEqual({ age, hidden, clockWarning: false });
  });

  it("does not hide unknown or future timestamps, and accepts a real epoch-zero timestamp", () => {
    for (const time of [undefined, NaN, Infinity]) {
      expect(meshlogContactState({ ...contact, heardAt: time }, settings, heardAt)).toMatchObject({ age: "unknown", hidden: false });
    }
    expect(meshlogContactState(contact, settings, heardAt - day)).toMatchObject({ age: "fresh", hidden: false });
    expect(meshlogContactState({ ...contact, heardAt: 0 }, settings, 3 * day)).toMatchObject({ age: "expired", hidden: false });
    expect(meshlogContactState(contact, settings, NaN)).toMatchObject({ age: "unknown", hidden: false });
  });

  it("falls back to a real node-detail timestamp and can reveal retained contacts again", () => {
    const detailContact = { ...contact, heardAt: undefined, detail: liveNodeDetail() };
    const now = detailContact.detail.lastSeen + 22 * day;
    expect(meshlogContactState(detailContact, settings, now).hidden).toBe(true);
    expect(meshlogContactState(detailContact, { ...settings, hideAfterDays: 30 }, now).hidden).toBe(false);
    expect(detailContact.detail.lastSeen).toBe(heardAt);
  });

  it.each([-1800, 1800])("warns at the actual signed clock drift boundary %i without replacing the server verdict", drift => {
    const detail = { ...liveNodeDetail(), clockDriftSeconds: drift, clockOutOfSync: false };
    expect(meshlogContactState({ ...contact, detail }, settings, heardAt).clockWarning).toBe(true);
    expect(detail.clockOutOfSync).toBe(false);
    expect(meshlogContactState({ ...contact, detail }, { ...settings, clockWarningAfterMinutes: 31 }, heardAt).clockWarning).toBe(false);
    expect(meshlogContactState({ ...contact, detail }, { ...settings, timeWarnings: false }, heardAt).clockWarning).toBe(false);
  });

  it("never invents clock warnings for missing/nonfinite readings, even if the server marks a node out of sync", () => {
    for (const drift of [undefined, NaN, Infinity, 1799, -1799]) {
      const detail = { ...liveNodeDetail(), clockDriftSeconds: drift, clockOutOfSync: true };
      expect(meshlogContactState({ ...contact, detail }, settings, heardAt).clockWarning).toBe(false);
    }
    expect(meshlogContactState(contact, { ...settings, timeWarnings: false }, heardAt + 22 * day).hidden).toBe(true);
  });
});
