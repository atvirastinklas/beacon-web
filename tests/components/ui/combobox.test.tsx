import { createRef } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Combobox, ComboboxContent, ComboboxInput, ComboboxItem, ComboboxList, ComboboxTrigger } from "../../../src/components/ui/combobox";

describe("shared Base UI combobox composition", () => {
  it("preserves refs, primitive state classes and multiple selection semantics", async () => {
    const input = createRef<HTMLInputElement>();
    const trigger = createRef<HTMLButtonElement>();
    render(<Combobox multiple items={["Alpha", "Beta"]}>
      <ComboboxTrigger ref={trigger} aria-label="Pick values">Values</ComboboxTrigger>
      <ComboboxContent aria-label="Values">
        <ComboboxInput ref={input} aria-label="Search values" />
        <ComboboxList aria-label="Values">{(value: string) => <ComboboxItem key={value} value={value} className={state => state.selected ? "chosen" : "available"}>{value}</ComboboxItem>}</ComboboxList>
      </ComboboxContent>
    </Combobox>);
    expect(trigger.current).toBe(await screen.findByRole("combobox", { name: "Pick values" }));
    fireEvent.click(trigger.current!);
    await waitFor(() => expect(input.current).toHaveFocus());
    expect(screen.getByRole("listbox", { name: "Values" })).toHaveAttribute("aria-multiselectable", "true");
    const alpha = screen.getByRole("option", { name: "Alpha" });
    expect(alpha).toHaveClass("available");
    fireEvent.click(alpha);
    expect(alpha).toHaveClass("chosen");
    expect(alpha).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(input.current!, { key: "Escape" });
    await waitFor(() => expect(trigger.current).toHaveFocus());
  });
});
