import type { MeshlogContact } from "./types";

export interface ContactSettings {
  expiredAfterDays: number;
  veryExpiredAfterDays: number;
  hideAfterDays: number;
  timeWarnings: boolean;
  clockWarningAfterMinutes: number;
  locationWarnings: boolean;
}

export const DEFAULT_CONTACT_SETTINGS: Readonly<ContactSettings> = {
  expiredAfterDays: 3, veryExpiredAfterDays: 7, hideAfterDays: 21,
  timeWarnings: true, clockWarningAfterMinutes: 30, locationWarnings: true,
};

const positiveInteger = (value: number | undefined, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(1, Math.floor(value)) : fallback;

/** Keep warning and hiding thresholds ordered, including during numeric input edits. */
export function normalizeContactSettings(input: Partial<ContactSettings>): ContactSettings {
  const defaults = DEFAULT_CONTACT_SETTINGS;
  const expiredAfterDays = positiveInteger(input.expiredAfterDays, defaults.expiredAfterDays);
  const veryExpiredAfterDays = Math.max(expiredAfterDays, positiveInteger(input.veryExpiredAfterDays, defaults.veryExpiredAfterDays));
  return {
    expiredAfterDays, veryExpiredAfterDays,
    hideAfterDays: Math.max(veryExpiredAfterDays, positiveInteger(input.hideAfterDays, defaults.hideAfterDays)),
    timeWarnings: input.timeWarnings ?? defaults.timeWarnings,
    clockWarningAfterMinutes: positiveInteger(input.clockWarningAfterMinutes, defaults.clockWarningAfterMinutes),
    locationWarnings: input.locationWarnings ?? defaults.locationWarnings,
  };
}

/** Presentation only: never discard retained data or replace the server's clock verdict. */
export function meshlogContactState(contact: MeshlogContact, settings: ContactSettings, now: number): {
  age: "unknown" | "fresh" | "expired" | "veryExpired";
  hidden: boolean;
  clockWarning: boolean;
} {
  const heardAt = Number.isFinite(contact.heardAt) ? contact.heardAt : contact.detail?.lastSeen;
  const ageDays = typeof heardAt === "number" && Number.isFinite(heardAt) && Number.isFinite(now)
    ? Math.max(0, now - heardAt) / 86_400_000 : undefined;
  const drift = contact.detail?.clockDriftSeconds;
  return {
    age: ageDays === undefined ? "unknown" : ageDays >= settings.veryExpiredAfterDays ? "veryExpired"
      : ageDays >= settings.expiredAfterDays ? "expired" : "fresh",
    hidden: ageDays !== undefined && ageDays >= settings.hideAfterDays,
    clockWarning: settings.timeWarnings && typeof drift === "number" && Number.isFinite(drift)
      && Math.abs(drift) >= settings.clockWarningAfterMinutes * 60,
  };
}
