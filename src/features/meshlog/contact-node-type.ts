import { NODE_TYPE_NAMES, type NodeTypeName } from "../../lib/node-types";
import type { MeshlogContact } from "./types";

const kindTypes = { client: "companion", repeater: "repeater", room: "room_server", sensor: "sensor", unknown: "unknown" };
export function contactNodeType(contact: MeshlogContact): NodeTypeName | "unknown" {
  const value = (contact.node?.nodeTypeName ?? kindTypes[contact.kind]).toLowerCase();
  return NODE_TYPE_NAMES.includes(value as NodeTypeName) ? value as NodeTypeName : "unknown";
}
