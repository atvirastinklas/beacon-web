import type { ComponentProps } from "react";
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import { cn } from "../../lib/cn";

const TooltipProvider = TooltipPrimitive.Provider;
const Tooltip = TooltipPrimitive.Root;
// Base UI 1.9 tooltips are visual hints: callers must label the trigger accessibly.
// Explicit aria-describedby on the trigger and id/role on content are also supported.
const TooltipTrigger = TooltipPrimitive.Trigger;

// shadcn's Base UI composition, using Beacon's shared surface and text tokens.
function TooltipContent({
  className,
  side = "top",
  sideOffset = 6,
  align = "center",
  alignOffset = 0,
  collisionPadding = 8,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Popup> &
  Pick<TooltipPrimitive.Positioner.Props, "side" | "sideOffset" | "align" | "alignOffset" | "collisionPadding">) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        collisionPadding={collisionPadding}
        className="isolate z-50"
      >
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={(state) => cn(
            "w-fit max-w-[min(20rem,calc(100vw-1rem))] rounded-md border border-border bg-bg-raised px-2 py-1 text-xs leading-4 text-text-bright shadow-lg whitespace-normal [overflow-wrap:anywhere]",
            typeof className === "function" ? className(state) : className,
          )}
          {...props}
        />
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  );
}

export { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent };
