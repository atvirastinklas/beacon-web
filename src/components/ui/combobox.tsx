import type { ComponentProps } from "react";
import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox";
import { cn } from "../../lib/cn";

const Combobox = ComboboxPrimitive.Root;
const ComboboxValue = ComboboxPrimitive.Value;
const ComboboxCollection = ComboboxPrimitive.Collection;
const ComboboxGroup = ComboboxPrimitive.Group;

function ComboboxTrigger({ className, children, ...props }: ComponentProps<typeof ComboboxPrimitive.Trigger>) {
  return <ComboboxPrimitive.Trigger data-slot="combobox-trigger" className={state => cn(
    "flex min-h-9 w-full items-center justify-between gap-2 rounded-md border border-border bg-bg-raised px-3 py-2 text-left text-xs text-text-bright disabled:opacity-50",
    typeof className === "function" ? className(state) : className,
  )} {...props}>
    {children}
    <ComboboxPrimitive.Icon><svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg></ComboboxPrimitive.Icon>
  </ComboboxPrimitive.Trigger>;
}

// shadcn's Base UI popup composition, using Beacon's surface and text tokens.
function ComboboxContent({ className, side = "bottom", align = "start", sideOffset = 4, collisionPadding = 8, ...props }:
  ComponentProps<typeof ComboboxPrimitive.Popup> & Pick<ComboboxPrimitive.Positioner.Props, "side" | "align" | "sideOffset" | "collisionPadding">) {
  return <ComboboxPrimitive.Portal>
    <ComboboxPrimitive.Positioner side={side} align={align} sideOffset={sideOffset} collisionPadding={collisionPadding} className="isolate z-50">
      <ComboboxPrimitive.Popup data-slot="combobox-content" className={state => cn(
        "flex max-h-[min(24rem,var(--available-height))] w-[var(--anchor-width)] max-w-[var(--available-width)] flex-col overflow-hidden rounded-md border border-border bg-bg-raised text-xs text-text-bright shadow-lg",
        typeof className === "function" ? className(state) : className,
      )} {...props} />
    </ComboboxPrimitive.Positioner>
  </ComboboxPrimitive.Portal>;
}

function ComboboxInput({ className, ...props }: ComponentProps<typeof ComboboxPrimitive.Input>) {
  return <ComboboxPrimitive.Input data-slot="combobox-input" className={state => cn(
    "min-h-9 w-full shrink-0 border-b border-border bg-transparent px-3 py-2 text-xs text-text-bright outline-offset-[-2px] placeholder:text-text-muted disabled:opacity-50",
    typeof className === "function" ? className(state) : className,
  )} {...props} />;
}

function ComboboxList({ className, ...props }: ComponentProps<typeof ComboboxPrimitive.List>) {
  return <ComboboxPrimitive.List data-slot="combobox-list" className={state => cn(
    "min-h-0 overflow-y-auto overscroll-contain p-1 [scrollbar-width:thin] empty:p-0",
    typeof className === "function" ? className(state) : className,
  )} {...props} />;
}

function ComboboxItem({ className, children, ...props }: ComponentProps<typeof ComboboxPrimitive.Item>) {
  return <ComboboxPrimitive.Item data-slot="combobox-item" className={state => cn(
    "relative flex min-h-8 cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 outline-none data-highlighted:bg-primary/12 data-highlighted:text-text-bright data-disabled:opacity-50",
    typeof className === "function" ? className(state) : className,
  )} {...props}>
    {children}
    <ComboboxPrimitive.ItemIndicator className="absolute right-2 flex size-4 items-center justify-center">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m3 8 3 3 7-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </ComboboxPrimitive.ItemIndicator>
  </ComboboxPrimitive.Item>;
}

function ComboboxLabel({ className, ...props }: ComponentProps<typeof ComboboxPrimitive.GroupLabel>) {
  return <ComboboxPrimitive.GroupLabel data-slot="combobox-label" className={state => cn(
    "px-2 py-1.5 text-[10px] font-medium text-text-normal",
    typeof className === "function" ? className(state) : className,
  )} {...props} />;
}

function ComboboxSeparator({ className, ...props }: ComponentProps<typeof ComboboxPrimitive.Separator>) {
  return <ComboboxPrimitive.Separator data-slot="combobox-separator" className={state => cn(
    "my-1 h-px bg-border-subtle",
    typeof className === "function" ? className(state) : className,
  )} {...props} />;
}

function ComboboxEmpty({ className, ...props }: ComponentProps<typeof ComboboxPrimitive.Empty>) {
  return <ComboboxPrimitive.Empty data-slot="combobox-empty" className={state => cn(
    "px-3 py-6 text-center text-xs text-text-normal empty:p-0",
    typeof className === "function" ? className(state) : className,
  )} {...props} />;
}

export { Combobox, ComboboxValue, ComboboxTrigger, ComboboxContent, ComboboxInput, ComboboxList, ComboboxItem, ComboboxGroup, ComboboxLabel, ComboboxCollection, ComboboxSeparator, ComboboxEmpty };
