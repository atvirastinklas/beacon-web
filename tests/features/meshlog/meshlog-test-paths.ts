import type { PacketPath, PathPoint } from "../../../src/features/map/packet-path";
import { contacts, reporters, type DemoMessage } from "./meshlog-fixtures";

const contactsById = new Map(contacts.map(contact => [contact.id, contact]));
const contactsByName = new Map(contacts.map(contact => [contact.name, contact]));
const reportersById = new Map(reporters.map(reporter => [reporter.id, reporter]));

/** Draw only contiguous known locations in this explicitly synthetic snapshot. */
export function buildDemoPaths(messages: readonly DemoMessage[]): PacketPath[] {
  return messages.flatMap(message => message.reports.flatMap<PacketPath>(report => {
    const reporter = reportersById.get(report.reporterId);
    if (!reporter) return [];
    const chain = [
      contactsById.get(message.senderId),
      ...report.path.map(name => contactsByName.get(name)),
      { ...reporter, id: `reporter:${reporter.id}` },
    ];
    const points: PathPoint[] = [];
    let gap = false;
    for (const node of chain) {
      if (!node?.position) { gap = true; continue; }
      const [lng, lat] = node.position;
      const previous = points.at(-1);
      if (!gap && previous?.lng === lng && previous.lat === lat) continue;
      points.push({
        id: node.id, name: node.name, lng, lat,
        ...(gap && points.length ? { breakBefore: true } : {}),
      });
      gap = false;
    }
    if (!points.some((point, index) => index > 0 && !point.breakBefore)) return [];
    return [{ key: `${message.id}:${reporter.id}`, label: reporter.name, color: reporter.color, points }];
  }));
}
