import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { ContactSettings } from "../../../src/features/meshlog/ContactSettings";
import { DEFAULT_CONTACT_SETTINGS } from "../../../src/features/meshlog/contact-settings";
import i18n from "../../../src/i18n";

function Harness() {
  const [settings, setSettings] = useState(DEFAULT_CONTACT_SETTINGS);
  return <ContactSettings value={settings} onChange={setSettings} />;
}

describe("supported Meshlog contact settings", () => {
  it("uses real day/minute thresholds and normalizes their order on commit", () => {
    render(<Harness />);
    const expired = screen.getByRole("spinbutton", { name: "Expired after (days)" });
    const veryExpired = screen.getByRole("spinbutton", { name: "Very expired after (days)" });
    const hide = screen.getByRole("spinbutton", { name: "Hide after (days)" });
    expect(expired).toHaveValue(3); expect(veryExpired).toHaveValue(7); expect(hide).toHaveValue(21);
    expect(screen.getByRole("spinbutton", { name: "Clock warning after (minutes)" })).toHaveValue(30);
    fireEvent.change(expired, { target: { value: "40" } });
    fireEvent.blur(expired);
    expect(expired).toHaveValue(40); expect(veryExpired).toHaveValue(40); expect(hide).toHaveValue(40);
    fireEvent.change(hide, { target: { value: "45" } });
    fireEvent.keyDown(hide, { key: "Enter" });
    expect(hide).toHaveValue(45);
  });

  it("allows an unfinished numeric edit and explains invalid values instead of applying them", () => {
    render(<Harness />);
    const expired = screen.getByRole("spinbutton", { name: "Expired after (days)" });
    fireEvent.change(expired, { target: { value: "" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.blur(expired);
    expect(expired).toHaveAttribute("aria-invalid", "true");
    expect(expired).toHaveAccessibleDescription("Enter a whole number greater than zero.");
    expect(screen.getByRole("spinbutton", { name: "Very expired after (days)" })).toHaveValue(7);
    fireEvent.change(expired, { target: { value: "2" } });
    fireEvent.blur(expired);
    expect(expired).toHaveValue(2);
    expect(expired).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps supported warning toggles functional and unavailable interval/telemetry controls honest", () => {
    render(<Harness />);
    const time = screen.getByRole("checkbox", { name: "Show time warnings" });
    const location = screen.getByRole("checkbox", { name: "Show location warnings" });
    expect(time).toBeChecked(); expect(location).toBeChecked();
    fireEvent.click(time);
    expect(time).not.toBeChecked();
    expect(screen.getByRole("spinbutton", { name: "Clock warning after (minutes)" })).toBeDisabled();
    fireEvent.click(location); expect(location).not.toBeChecked();
    const advert = screen.getByRole("checkbox", { name: "Show advert interval" });
    const telemetry = screen.getByRole("checkbox", { name: "Show telemetry" });
    expect(advert).toBeDisabled(); expect(advert).not.toBeChecked();
    expect(advert).toHaveAccessibleDescription("Unavailable: advert intervals are not provided.");
    expect(telemetry).toBeDisabled(); expect(telemetry).not.toBeChecked();
    expect(telemetry).toHaveAccessibleDescription("Unavailable: telemetry is not provided.");
  });

  it("provides Lithuanian labels, units and unavailability explanations", async () => {
    await act(async () => { await i18n.changeLanguage("lt"); });
    render(<Harness />);
    expect(screen.getByRole("spinbutton", { name: i18n.t("meshlog.settings.expiredAfterDays") })).toHaveValue(3);
    expect(screen.getByRole("checkbox", { name: i18n.t("meshlog.settings.telemetry") })).toHaveAccessibleDescription(i18n.t("meshlog.settings.telemetryUnavailable"));
  });
});
