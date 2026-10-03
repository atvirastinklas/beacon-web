import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LanguagePicker } from "../../src/components/LanguagePicker";

describe("Lithuanian language selection", () => {
  it("offers the native name, persists the choice and keeps focus and translated accessible labels", async () => {
    render(<LanguagePicker />);
    const trigger = screen.getByRole("button", { name: "Language: English" });
    fireEvent.click(trigger);
    const option = screen.getByRole("button", { name: "Lietuvių", exact: true });
    expect(option).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("Lietuvių")).toHaveAttribute("lang", "lt");
    fireEvent.click(option);

    await waitFor(() => expect(screen.getByRole("button", { name: "Kalba: Lietuvių" })).toHaveFocus());
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveAttribute("title", "Pasirinkite kalbą.");
    expect(trigger).toHaveTextContent("LT");
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
    expect(localStorage.getItem("beacon-language")).toBe("lt");
    expect(document.documentElement.lang).toBe("lt");
    expect(document.documentElement.dir).toBe("ltr");

    fireEvent.click(trigger);
    expect(screen.getByRole("group", { name: "Kalba" })).toBeInTheDocument();
    const selected = screen.getByRole("button", { name: "Lietuvių", exact: true });
    expect(selected).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "English", exact: true })).toHaveAttribute("aria-pressed", "false");
    selected.focus();
    fireEvent.keyDown(selected, { key: "Escape" });
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(localStorage.getItem("beacon-language")).toBe("lt");
  });
});
