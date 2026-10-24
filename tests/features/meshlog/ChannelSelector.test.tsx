import { useState } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChannelSelector } from "../../../src/features/meshlog/ChannelSelector";
import type { MeshlogChannel } from "../../../src/features/meshlog/types";

const channels: MeshlogChannel[] = [
  { id: "aa", name: "Public", keyKnown: true },
  { id: "bb", name: "Named but encrypted", keyKnown: false },
  { id: "cc", name: "Public", keyKnown: true },
  { id: "dd", name: "deadbeef", keyKnown: true },
];

function Selector({ items = channels, initial = null, changed = () => {} }: {
  items?: MeshlogChannel[]; initial?: string[] | null; changed?: (selection: string[] | null) => void;
}) {
  const [selection, setSelection] = useState(initial);
  return <ChannelSelector channels={items} selection={selection} onSelectionChange={next => { changed(next); setSelection(next); }} />;
}

async function open() {
  fireEvent.click(await screen.findByRole("combobox", { name: /Select channels/ }));
  return screen.getByRole("dialog", { name: "Channels" });
}

describe("Meshlog grouped channel combobox", () => {
  it("toggles whole known and unknown groups independently, including mixed states and search-hidden options", async () => {
    render(<Selector />);
    const popup = await open();
    const known = within(popup).getByRole("button", { name: "Known channels" });
    const unknown = within(popup).getByRole("button", { name: "Unknown channels" });
    expect(known).toHaveAttribute("aria-pressed", "true");
    expect(known).toHaveAccessibleDescription("3 / 3");
    fireEvent.click(known);
    expect(within(popup).getAllByRole("option", { selected: true })).toHaveLength(1);
    expect(within(popup).getByRole("option", { name: "#Named but encrypted" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(within(popup).getAllByRole("option", { name: "#Public" })[0]!);
    expect(known).toHaveAttribute("aria-pressed", "mixed");
    fireEvent.change(within(popup).getByRole("combobox", { name: "Search channels" }), { target: { value: "CC" } });
    fireEvent.click(known);
    expect(known).toHaveAttribute("aria-pressed", "true");
    expect(known).toHaveAccessibleDescription("3 / 3");
    expect(within(popup).getByRole("option", { name: "#Public" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(unknown);
    expect(known).toHaveAttribute("aria-pressed", "true");
    expect(unknown).toHaveAttribute("aria-pressed", "false");
    fireEvent.change(within(popup).getByRole("combobox", { name: "Search channels" }), { target: { value: "" } });
    expect(within(popup).getAllByRole("option", { selected: true })).toHaveLength(3);
  });

  it("keeps group actions as current-ID snapshots and preserves selections missing from the directory", async () => {
    const changed = vi.fn();
    const view = render(<Selector initial={[...channels.map(channel => channel.id), "not-loaded"]} changed={changed} />);
    const popup = await open();
    fireEvent.click(within(popup).getByRole("button", { name: "Known channels" }));
    expect(changed).toHaveBeenLastCalledWith(["bb", "not-loaded"]);
    view.rerender(<Selector items={[...channels, { id: "ee", name: "New unknown", keyKnown: false }]} initial={[]} changed={changed} />);
    expect(within(popup).getByRole("option", { name: "#New unknown" })).toHaveAttribute("aria-selected", "false");
    fireEvent.click(within(popup).getByRole("button", { name: "Unknown channels" }));
    expect(changed).toHaveBeenLastCalledWith(["bb", "not-loaded", "ee"]);
    fireEvent.click(within(popup).getByRole("button", { name: "Unknown channels" }));
    expect(changed).toHaveBeenLastCalledWith(["not-loaded"]);
    fireEvent.click(within(popup).getByRole("button", { name: "All" }));
    expect(changed).toHaveBeenLastCalledWith(null);
  });

  it("bounds a large selection to one compact summary and a scrollable list of checked options", async () => {
    const many = Array.from({ length: 256 }, (_, index) => ({ id: `hash-${index}`, name: `Channel ${index}`, keyKnown: index < 5 }));
    const view = render(<Selector items={many} />);
    expect(await screen.findByRole("combobox", { name: /Select channels/ })).toHaveTextContent("All · 256");
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
    const popup = await open();
    const list = within(popup).getByRole("listbox", { name: "Channels" });
    expect(list).toHaveAttribute("aria-multiselectable", "true");
    expect(within(list).getAllByRole("option", { selected: true })).toHaveLength(256);
    expect(within(list).getByRole("option", { name: "#Channel 255" })).toHaveAttribute("aria-selected", "true");
    expect(within(popup).queryByRole("tab")).not.toBeInTheDocument();
    expect(within(popup).queryByRole("checkbox")).not.toBeInTheDocument();
    expect(within(popup).queryByText("hash-255")).not.toBeInTheDocument();
    view.unmount();
    render(<Selector items={many} initial={many.slice(0, -1).map(channel => channel.id)} />);
    const trigger = await screen.findByRole("combobox", { name: /Select channels/ });
    expect(trigger.querySelectorAll(".meshlog-channel-badge")).toHaveLength(1);
    expect(trigger).toHaveTextContent("+254");
  });

  it("groups by key knowledge and disambiguates duplicate names without exposing every hash", async () => {
    const changed = vi.fn();
    render(<Selector changed={changed} />);
    const popup = await open();
    const known = within(popup).getByRole("group", { name: "Known channels" });
    const unknown = within(popup).getByRole("group", { name: "Unknown channels" });
    expect(within(known).getByRole("option", { name: "#deadbeef" })).toBeInTheDocument();
    expect(within(unknown).getByRole("option", { name: "#Named but encrypted" })).toBeInTheDocument();
    expect(within(known).queryByText("dd")).not.toBeInTheDocument();
    const duplicates = within(known).getAllByRole("option", { name: "#Public" });
    expect(duplicates[0]).toHaveAccessibleDescription("aa");
    expect(duplicates[1]).toHaveAccessibleDescription("cc");
    fireEvent.click(duplicates[0]!);
    expect(changed).toHaveBeenLastCalledWith(["bb", "cc", "dd"]);
    expect(duplicates[0]).toHaveAttribute("aria-selected", "false");
    expect(duplicates[1]).toHaveAttribute("aria-selected", "true");
  });

  it("searches names and hashes and retains the query while selecting multiple results", async () => {
    render(<Selector />);
    const popup = await open();
    const search = within(popup).getByRole("combobox", { name: "Search channels" });
    fireEvent.change(search, { target: { value: "CC" } });
    expect(within(popup).getAllByRole("option")).toHaveLength(1);
    const option = within(popup).getByRole("option", { name: "#Public" });
    expect(option).toHaveAccessibleDescription("cc");
    fireEvent.click(option);
    expect(search).toHaveValue("CC");
    expect(option).toHaveAttribute("aria-selected", "false");
    fireEvent.change(search, { target: { value: "NAMED BUT" } });
    expect(within(popup).getByRole("option", { name: "#Named but encrypted" })).toBeInTheDocument();
    fireEvent.change(search, { target: { value: "missing" } });
    expect(within(popup).getByText("No matching channels loaded.")).toBeInTheDocument();
    expect(within(popup).queryByRole("option")).not.toBeInTheDocument();
  });

  it("keeps all live and none/subsets as snapshots across arriving and refreshed channel objects", async () => {
    const changed = vi.fn();
    const view = render(<Selector items={channels.slice(0, 1)} changed={changed} />);
    const popup = await open();
    view.rerender(<Selector items={channels} changed={changed} />);
    expect(within(popup).getByRole("option", { name: "#Named but encrypted" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(within(popup).getByRole("button", { name: "None" }));
    expect(changed).toHaveBeenLastCalledWith([]);
    const next = [...channels, { id: "ee", name: "New channel", keyKnown: true }];
    view.rerender(<Selector items={next} changed={changed} />);
    expect(within(popup).getByRole("option", { name: "#New channel" })).toHaveAttribute("aria-selected", "false");
    fireEvent.click(within(popup).getAllByRole("option", { name: "#Public" })[1]!);
    expect(changed).toHaveBeenLastCalledWith(["cc"]);
    view.rerender(<Selector items={[...next.map(channel => ({ ...channel })), { id: "ff", name: "Later channel", keyKnown: true }]} changed={changed} />);
    expect(within(popup).getAllByRole("option", { name: "#Public" })[1]).toHaveAttribute("aria-selected", "true");
    expect(within(popup).getByRole("option", { name: "#Later channel" })).toHaveAttribute("aria-selected", "false");
    fireEvent.click(within(popup).getByRole("button", { name: "All" }));
    expect(changed).toHaveBeenLastCalledWith(null);
    expect(within(popup).getByRole("option", { name: "#Later channel" })).toHaveAttribute("aria-selected", "true");
  });

  it("uses primitive Arrow/Enter selection and Escape dismissal with focus return", async () => {
    render(<Selector initial={[]} />);
    const trigger = await screen.findByRole("combobox", { name: /Select channels/ });
    const popup = await open();
    const input = within(popup).getByRole("combobox", { name: "Search channels" });
    await waitFor(() => expect(input).toHaveFocus());
    fireEvent.keyDown(input, { key: "ArrowDown" });
    const first = within(popup).getAllByRole("option")[0]!;
    await waitFor(() => expect(input).toHaveAttribute("aria-activedescendant", first.id));
    fireEvent.keyDown(input, { key: "Enter" });
    expect(first).toHaveAttribute("aria-selected", "true");
    expect(popup).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(first).toHaveAttribute("aria-selected", "false");
    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => expect(popup).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("supports outside dismissal and an empty directory", async () => {
    render(<><Selector items={[]} /><button>Outside</button></>);
    const popup = await open();
    expect(await within(popup).findByText("No channels available yet.")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("button", { name: "Outside" }));
    fireEvent.click(screen.getByRole("button", { name: "Outside" }));
    await waitFor(() => expect(popup).not.toBeInTheDocument());
  });
});
