import { createRef } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../../../src/components/ui/tooltip";

function ObserverTooltip() {
  return (
    <TooltipProvider delay={0}>
      <Tooltip>
        <TooltipTrigger aria-describedby="observer-details" render={<span tabIndex={0} className="inline-block max-w-20 truncate" />}>VNO…</TooltipTrigger>
        <TooltipContent id="observer-details" role="tooltip">
          <div>Vilnius observer</div>
          <div>0123456789abcdef0123456789abcdef</div>
          <div>VNO · Online</div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

describe("shared Tooltip", () => {
  it("opens on keyboard focus, preserves an explicit description, and dismisses with Escape without moving focus", async () => {
    render(<ObserverTooltip />);
    const trigger = screen.getByText("VNO…");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    fireEvent.keyDown(document.body, { key: "Tab" });
    act(() => trigger.focus());
    const content = await screen.findByRole("tooltip");
    expect(trigger).toHaveAttribute("aria-describedby", content.id);
    expect(trigger).toHaveAccessibleDescription("Vilnius observer 0123456789abcdef0123456789abcdef VNO · Online");
    expect(content).toHaveAttribute("data-slot", "tooltip-content");

    fireEvent.keyDown(trigger, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("tooltip")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute("aria-describedby", "observer-details");
  });

  it("opens on hover and portals outside an overflow-clipped ancestor", async () => {
    const { container } = render(<div style={{ overflowY: "auto" }}><ObserverTooltip /></div>);
    const trigger = screen.getByText("VNO…");
    fireEvent.mouseEnter(trigger);
    const content = await screen.findByRole("tooltip");
    expect(document.body).toContainElement(content);
    expect(container).not.toContainElement(content);
    expect(trigger).toHaveAttribute("aria-describedby", content.id);

    fireEvent.keyDown(trigger, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("tooltip")).not.toBeInTheDocument());
  });

  it("keeps a rendered span unwrapped and unstyled through open and closed states", async () => {
    const triggerRef = createRef<HTMLElement>();
    const onFocus = vi.fn();
    const { container } = render(
      <Tooltip>
        <TooltipTrigger ref={triggerRef} onFocus={onFocus} aria-label="Full observer name" render={<span tabIndex={0} className="truncate" style={{ maxWidth: 80 }} />}>
          Observer
        </TooltipTrigger>
        <TooltipContent>Full observer name</TooltipContent>
      </Tooltip>,
    );
    const trigger = screen.getByText("Observer");
    const initialClass = trigger.className;
    const initialStyle = trigger.getAttribute("style");
    expect(container.children).toHaveLength(1);
    expect(container.firstElementChild).toBe(trigger);
    expect(triggerRef.current).toBe(trigger);
    expect(trigger.tagName).toBe("SPAN");
    expect(trigger).toHaveAttribute("tabindex", "0");
    expect(trigger).not.toHaveAttribute("role", "button");
    expect(trigger).not.toHaveAttribute("type");

    act(() => trigger.focus());
    await screen.findByText("Full observer name");
    expect(trigger).toHaveAccessibleName("Full observer name");
    // Base UI 1.9 intentionally leaves naming/description to the consumer.
    expect(trigger).not.toHaveAttribute("aria-describedby");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(onFocus).toHaveBeenCalledOnce();
    expect(trigger.className).toBe(initialClass);
    expect(trigger.getAttribute("style")).toBe(initialStyle);
    expect(container.firstElementChild).toBe(trigger);

    act(() => trigger.blur());
    await waitFor(() => expect(screen.queryByText("Full observer name")).not.toBeInTheDocument());
    expect(trigger.className).toBe(initialClass);
    expect(trigger.getAttribute("style")).toBe(initialStyle);
  });

  it("forwards content refs, state-based classes and controlled open-change events", async () => {
    const contentRef = createRef<HTMLDivElement>();
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <Tooltip open onOpenChange={onOpenChange}>
        <TooltipTrigger render={<span tabIndex={0} />}>Observer</TooltipTrigger>
        <TooltipContent ref={contentRef} role="tooltip" side="bottom" align="start" className={(state) => state.open ? "observer-info" : ""}>
          Full name
        </TooltipContent>
      </Tooltip>,
    );
    const content = await screen.findByRole("tooltip");
    expect(contentRef.current).toBe(content);
    expect(content).toHaveClass("observer-info", "bg-bg-raised", "text-text-bright");
    fireEvent.keyDown(screen.getByText("Observer"), { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false, expect.objectContaining({ reason: "escape-key" }));
    expect(content).toBeInTheDocument();

    rerender(<Tooltip open={false}><TooltipTrigger>Observer</TooltipTrigger><TooltipContent>Full name</TooltipContent></Tooltip>);
    await waitFor(() => expect(screen.queryByRole("tooltip")).not.toBeInTheDocument());
  });
});
