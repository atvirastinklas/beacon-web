import { expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MapStyleSwitcher } from "../../../src/features/map/MapStyleSwitcher";

it("identifies the selected style and forwards style selection", () => {
  const change = vi.fn();
  const { rerender } = render(<MapStyleSwitcher styleId="dark" onChange={change} />);
  const group = screen.getByRole("group", { name: "Map style" });
  const dark = within(group).getByRole("button", { name: "Dark" });
  const light = within(group).getByRole("button", { name: "Light" });
  expect(dark).toHaveAttribute("aria-pressed", "true");
  expect(light).toHaveAttribute("aria-pressed", "false");
  fireEvent.click(light);
  expect(change).toHaveBeenCalledExactlyOnceWith("light");
  rerender(<MapStyleSwitcher styleId="light" onChange={change} />);
  expect(dark).toHaveAttribute("aria-pressed", "false");
  expect(light).toHaveAttribute("aria-pressed", "true");
});
