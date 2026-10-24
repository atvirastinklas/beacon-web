import type { ReactNode } from "react";
import { Popover } from "@base-ui/react/popover";
import { useTranslation } from "react-i18next";

// Feature-local shadcn-style composition using the installed Base UI primitives.
// The primitive owns positioning, focus return, outside dismissal and Escape.
export function SettingsPopover({ title, children }: { title: string; children: ReactNode }) {
  const { t } = useTranslation();
  return <Popover.Root>
    <Popover.Trigger className="meshlog-settings-trigger" aria-label={`${title} · ${t("header.settings")}`}>{t("header.settings")}</Popover.Trigger>
    <Popover.Portal>
      <Popover.Positioner side="bottom" align="end" sideOffset={5} collisionPadding={8} className="meshlog-popover-positioner">
        <Popover.Popup className="meshlog-popover">
          <div className="meshlog-popover-header"><Popover.Title>{title}</Popover.Title><Popover.Close aria-label={t("common.close")}>×</Popover.Close></div>
          {children}
        </Popover.Popup>
      </Popover.Positioner>
    </Popover.Portal>
  </Popover.Root>;
}
