import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { normalizeContactSettings, type ContactSettings as Settings } from "./contact-settings";

function ThresholdInput({ label, value, disabled, onCommit }: { label: string; value: number; disabled?: boolean; onCommit: (value: number) => void }) {
  const { t } = useTranslation();
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const commit = () => {
    if (draft === null) return;
    const number = Number(draft);
    if (!draft.trim() || !Number.isInteger(number) || number <= 0) { setInvalid(true); return; }
    onCommit(number);
    setDraft(null);
    setInvalid(false);
  };
  return <div className="meshlog-setting-field">
    <label htmlFor={id}>{label}</label>
    <input id={id} type="number" min={1} step={1} required disabled={disabled} value={draft ?? value}
      aria-invalid={invalid || undefined} aria-describedby={invalid ? `${id}-error` : undefined}
      onChange={event => { setDraft(event.target.value); setInvalid(false); }} onBlur={commit}
      onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); commit(); } }} />
    {invalid && <p id={`${id}-error`} role="alert">{t("meshlog.settings.positiveInteger")}</p>}
  </div>;
}

export function ContactSettings({ value, onChange }: { value: Settings; onChange: (settings: Settings) => void }) {
  const { t } = useTranslation();
  const id = useId();
  const update = (patch: Partial<Settings>) => onChange(normalizeContactSettings({ ...value, ...patch }));
  return <div className="meshlog-contact-settings">
    <p className="meshlog-settings-note">{t("meshlog.settings.ageHelp")}</p>
    <ThresholdInput label={t("meshlog.settings.expiredAfterDays")} value={value.expiredAfterDays} onCommit={expiredAfterDays => update({ expiredAfterDays })} />
    <ThresholdInput label={t("meshlog.settings.veryExpiredAfterDays")} value={value.veryExpiredAfterDays} onCommit={veryExpiredAfterDays => update({ veryExpiredAfterDays })} />
    <ThresholdInput label={t("meshlog.settings.hideAfterDays")} value={value.hideAfterDays} onCommit={hideAfterDays => update({ hideAfterDays })} />
    <p className="meshlog-settings-note">{t("meshlog.settings.thresholdHelp")}</p>
    <label className="meshlog-setting-check"><input type="checkbox" checked={value.timeWarnings} onChange={event => update({ timeWarnings: event.target.checked })} />{t("meshlog.settings.timeWarnings")}</label>
    <ThresholdInput label={t("meshlog.settings.clockWarningAfterMinutes")} value={value.clockWarningAfterMinutes} disabled={!value.timeWarnings} onCommit={clockWarningAfterMinutes => update({ clockWarningAfterMinutes })} />
    <label className="meshlog-setting-check"><input type="checkbox" checked={value.locationWarnings} onChange={event => update({ locationWarnings: event.target.checked })} />{t("meshlog.settings.locationWarnings")}</label>
    <div className="meshlog-unavailable-setting">
      <label className="meshlog-setting-check"><input type="checkbox" disabled checked={false} aria-describedby={`${id}-advert`} readOnly />{t("meshlog.settings.advertInterval")}</label>
      <p id={`${id}-advert`}>{t("meshlog.settings.advertUnavailable")}</p>
    </div>
    <div className="meshlog-unavailable-setting">
      <label className="meshlog-setting-check"><input type="checkbox" disabled checked={false} aria-describedby={`${id}-telemetry`} readOnly />{t("meshlog.settings.telemetry")}</label>
      <p id={`${id}-telemetry`}>{t("meshlog.settings.telemetryUnavailable")}</p>
    </div>
  </div>;
}
