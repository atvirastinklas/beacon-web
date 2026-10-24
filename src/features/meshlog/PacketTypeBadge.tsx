import { Badge } from "../../components/Badge";
import { payloadTypeVariant } from "../../components/badge-utils";

export function PacketTypeBadge({ payloadType, label }: { payloadType: number; label: string }) {
  return <span className="meshlog-packet-type-badge"><Badge variant={payloadTypeVariant(payloadType)}>{label}</Badge></span>;
}
