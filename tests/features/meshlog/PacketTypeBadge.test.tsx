import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PacketTypeBadge } from "../../../src/features/meshlog/PacketTypeBadge";
import { packetTypeLabel } from "../../../src/features/meshlog/packet-type";
import { payloadTypeVariant, VARIANT_CLASSES } from "../../../src/components/badge-utils";
import { PAYLOAD_TYPE_NAMES, PayloadType } from "../../../src/types/enums";
import i18n from "../../../src/i18n";

describe("Meshlog protocol type badges", () => {
  it.each(Object.entries(PAYLOAD_TYPE_NAMES))("uses Beacon's label and color for type %s", (code, name) => {
    const type = Number(code);
    const label = packetTypeLabel(type, "Category label", i18n.t);
    expect(label).toBe(name);
    render(<PacketTypeBadge payloadType={type} label={label} />);
    const badge = screen.getByText(name);
    expect(badge.parentElement).toHaveClass("meshlog-packet-type-badge");
    expect(badge).toHaveClass(...VARIANT_CLASSES[payloadTypeVariant(type)].split(" "));
  });

  it("keeps unknown wire codes distinct with a server label or a numeric fallback", () => {
    expect(packetTypeLabel(127, "Encrypted 0x7f", i18n.t)).toBe("Encrypted 0x7f");
    expect(packetTypeLabel(14, undefined, i18n.t)).toBe("Unknown 14");
    expect(packetTypeLabel(PayloadType.GROUP_DATA, "Channel", i18n.t)).toBe("GRP_DATA");
    render(<PacketTypeBadge payloadType={127} label="Encrypted 0x7f" />);
    expect(screen.getByText("Encrypted 0x7f")).toHaveClass(...VARIANT_CLASSES.default.split(" "));
  });
});
