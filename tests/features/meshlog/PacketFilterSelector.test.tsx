import { useState } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PacketFilterSelector, type PacketFilterOption } from "../../../src/features/meshlog/PacketFilterSelector";
import i18n from "../../../src/i18n";

const observers: PacketFilterOption<string>[] = [
  { id: "rx-a", name: "Observer", searchText: "aabbcc RIX", detail: "aabbcc · RIX" },
  { id: "rx-b", name: "Observer", searchText: "ddeeff KUN", detail: "ddeeff · KUN" },
  { id: "rx-c", name: "Remote observer" },
];
function Selector({ options = observers, initial = null, changed = () => {} }: {
  options?: PacketFilterOption<string>[]; initial?: string[] | null; changed?: (selection: string[] | null) => void;
}) {
  const [selection, setSelection] = useState(initial);
  return <PacketFilterSelector label="Observers" searchLabel="Search observers" options={options} selection={selection}
    onSelectionChange={value => { setSelection(value); changed(value); }} />;
}
function open() {
  fireEvent.click(screen.getByRole("combobox", { name: /^Observers/ }));
  return screen.getByRole("dialog", { name: "Observers" });
}

describe("compact packet filter combobox", () => {
  it("distinguishes the Lithuanian deselection action from the empty-selection summary", async () => {
    await i18n.changeLanguage("lt");
    const changed = vi.fn();
    render(<Selector changed={changed} />);
    const dialog = open();
    expect(within(dialog).getByRole("button", { name: "Visi", exact: true })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Nėra", exact: true })).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Atžymėti visus", exact: true }));
    expect(changed).toHaveBeenLastCalledWith([]);
    expect(screen.getByRole("combobox", { name: "Observers · Nėra" })).toBeInTheDocument();
    expect(within(dialog).queryAllByRole("option", { selected: true })).toHaveLength(0);
  });

  it("keeps many selected observers to one summary and exposes every selected option", () => {
    const options = Array.from({ length: 180 }, (_, i) => ({ id: `rx-${i}`, name: `Observer ${i}` }));
    render(<Selector options={options} initial={options.slice(1).map(option => option.id)} />);
    const trigger = screen.getByRole("combobox", { name: /^Observers/ });
    expect(trigger).toHaveTextContent("Observer 1+178");
    expect(trigger).not.toHaveTextContent("Observer 179");
    const dialog = open();
    expect(within(dialog).getAllByRole("option", { selected: true })).toHaveLength(179);
  });

  it("searches observer names, keys and region codes while keeping duplicate names independent", () => {
    const changed = vi.fn();
    render(<Selector changed={changed} />);
    const dialog = open();
    const duplicates = within(dialog).getAllByRole("option", { name: "Observer" });
    expect(duplicates[0]).toHaveAccessibleDescription("aabbcc · RIX");
    expect(duplicates[1]).toHaveAccessibleDescription("ddeeff · KUN");
    fireEvent.click(duplicates[0]!);
    expect(changed).toHaveBeenLastCalledWith(["rx-b", "rx-c"]);
    expect(duplicates[1]).toHaveAttribute("aria-selected", "true");
    const input = within(dialog).getByRole("combobox", { name: "Search observers" });
    for (const value of ["DDEEFF", "kun"]) {
      fireEvent.change(input, { target: { value } });
      expect(within(dialog).getAllByRole("option")).toHaveLength(1);
      expect(within(dialog).getByRole("option")).toHaveAccessibleDescription("ddeeff · KUN");
    }
    fireEvent.change(input, { target: { value: "remote" } });
    expect(within(dialog).getByRole("option", { name: "Remote observer" })).toBeInTheDocument();
    expect(within(dialog).queryByText("rx-c")).not.toBeInTheDocument();
    fireEvent.change(input, { target: { value: "missing" } });
    expect(within(dialog).getByText("No matches")).toBeInTheDocument();
  });

  it("follows new observers only in default all, preserving none and explicit subsets", () => {
    const changed = vi.fn();
    const view = render(<Selector options={observers.slice(0, 1)} changed={changed} />);
    const dialog = open();
    view.rerender(<Selector options={observers} changed={changed} />);
    expect(within(dialog).getAllByRole("option", { selected: true })).toHaveLength(3);
    fireEvent.click(within(dialog).getByRole("button", { name: "None" }));
    const next = [...observers, { id: "rx-d", name: "New observer" }];
    view.rerender(<Selector options={next} changed={changed} />);
    expect(within(dialog).getByRole("option", { name: "New observer" })).toHaveAttribute("aria-selected", "false");
    fireEvent.click(within(dialog).getAllByRole("option", { name: "Observer" })[1]!);
    expect(changed).toHaveBeenLastCalledWith(["rx-b"]);
    view.rerender(<Selector options={[...next, { id: "rx-e", name: "Later observer" }]} changed={changed} />);
    expect(within(dialog).getByRole("option", { name: "Later observer" })).toHaveAttribute("aria-selected", "false");
    fireEvent.click(within(dialog).getByRole("button", { name: "All" }));
    expect(changed).toHaveBeenLastCalledWith(null);
    expect(within(dialog).getAllByRole("option", { selected: true })).toHaveLength(5);
  });

  it("does not display internal observer IDs when duplicate names have no radio metadata", () => {
    const changed = vi.fn();
    render(<Selector changed={changed} options={[
      { id: "internal-observer-a", name: "Observer" },
      { id: "internal-observer-b", name: "Observer" },
    ]} />);
    const dialog = open();
    expect(within(dialog).queryByText("internal-observer-a")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("internal-observer-b")).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getAllByRole("option", { name: "Observer" })[0]!);
    expect(changed).toHaveBeenLastCalledWith(["internal-observer-b"]);
  });

  it("uses primitive keyboard selection and dismissal with focus return", async () => {
    render(<Selector initial={[]} />);
    const trigger = screen.getByRole("combobox", { name: /^Observers/ });
    const dialog = open();
    const input = within(dialog).getByRole("combobox", { name: "Search observers" });
    await waitFor(() => expect(input).toHaveFocus());
    fireEvent.keyDown(input, { key: "ArrowDown" });
    const first = within(dialog).getAllByRole("option")[0]!;
    await waitFor(() => expect(input).toHaveAttribute("aria-activedescendant", first.id));
    fireEvent.keyDown(input, { key: "Enter" });
    expect(first).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it("handles empty options and outside dismissal", async () => {
    render(<><Selector options={[]} /><button>Outside</button></>);
    const dialog = open();
    expect(await within(dialog).findByText("No data")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("button", { name: "Outside" }));
    fireEvent.click(screen.getByRole("button", { name: "Outside" }));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
  });
});
