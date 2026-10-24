// Invented records injected into presentation tests, never bundled with the application.
interface DemoReporter {
  id: string; name: string; color: string; position: [number, number];
}
// Explicit invented receiver positions, separate from the transmitting contacts.
export const reporters: DemoReporter[] = [
  { id: "old-town", name: "Old Town RX", color: "var(--color-primary)", position: [24.112, 56.955] },
  { id: "river", name: "River RX", color: "var(--color-secondary)", position: [24.072, 56.946] },
  { id: "north", name: "North RX", color: "var(--color-green)", position: [24.142, 56.986] },
];
export type ContactKind = "repeater" | "client" | "room" | "sensor";
export interface DemoContact {
  id: string; name: string; kind: ContactKind; heard: string; firstSeen: string;
  position: [number, number] | null; reporterIds: string[]; interval?: string; battery?: string;
}
export const contacts: DemoContact[] = [
  { id: "8a21", name: "Old Town Rooftop", kind: "repeater", heard: "10:24:18", firstSeen: "20 Oct 2026", position: [24.105, 56.951], reporterIds: ["old-town", "river"], interval: "15m", battery: "98%" },
  { id: "c4f0", name: "River Walker", kind: "client", heard: "10:23:52", firstSeen: "23 Oct 2026", position: [24.087, 56.943], reporterIds: ["river", "old-town"], battery: "76%" },
  { id: "72be", name: "North Relay", kind: "repeater", heard: "10:22:40", firstSeen: "18 Oct 2026", position: [24.134, 56.994], reporterIds: ["north", "old-town"], interval: "20m" },
  { id: "a901", name: "Riga Commons", kind: "room", heard: "10:21:06", firstSeen: "19 Oct 2026", position: [24.127, 56.966], reporterIds: ["old-town", "north"] },
  { id: "d35a", name: "Garden Weather", kind: "sensor", heard: "10:20:31", firstSeen: "21 Oct 2026", position: [24.172, 56.962], reporterIds: ["north"], interval: "10m", battery: "91%" },
  { id: "11d8", name: "East Link", kind: "repeater", heard: "10:18:12", firstSeen: "17 Oct 2026", position: [24.218, 56.956], reporterIds: ["north", "river"], interval: "15m" },
  { id: "b65c", name: "Pocket Radio", kind: "client", heard: "10:16:42", firstSeen: "24 Oct 2026", position: null, reporterIds: ["river"] },
  { id: "f0a2", name: "West Bank", kind: "repeater", heard: "10:15:10", firstSeen: "20 Oct 2026", position: [24.049, 56.955], reporterIds: ["river"], interval: "30m" },
  { id: "6c90", name: "Workshop Bench", kind: "client", heard: "10:12:29", firstSeen: "22 Oct 2026", position: [24.153, 56.94], reporterIds: ["old-town"] },
  { id: "340e", name: "South Garden", kind: "sensor", heard: "10:09:03", firstSeen: "21 Oct 2026", position: [24.118, 56.917], reporterIds: ["river"], interval: "10m", battery: "63%" },
  { id: "9ab7", name: "Evening Net", kind: "room", heard: "10:04:16", firstSeen: "19 Oct 2026", position: null, reporterIds: ["old-town", "north"] },
  { id: "e2f6", name: "Forest Edge Portable / Test Station", kind: "client", heard: "09:58:20", firstSeen: "24 Oct 2026", position: [24.196, 57.008], reporterIds: ["north"] },
];
export const channels = ["Public", "Local"] as const;
export type MessageKind = "channel" | "advertisement" | "direct";
export interface DemoMessage {
  id: string; time: string; senderId: string; kind: MessageKind; channel?: typeof channels[number]; text?: string;
  reports: { reporterId: string; time: string; path: string[] }[];
}
export const messages: DemoMessage[] = [
  { id: "m01", time: "10:24:18", senderId: "8a21", kind: "advertisement", reports: [{ reporterId: "old-town", time: "10:24:18", path: [] }, { reporterId: "river", time: "10:24:19", path: ["West Bank"] }] },
  { id: "m02", time: "10:23:52", senderId: "c4f0", kind: "channel", channel: "Public", text: "Morning check-in from the river path.", reports: [{ reporterId: "river", time: "10:23:52", path: [] }, { reporterId: "old-town", time: "10:23:53", path: ["West Bank", "Old Town Rooftop"] }] },
  { id: "m03", time: "10:22:40", senderId: "72be", kind: "advertisement", reports: [{ reporterId: "north", time: "10:22:40", path: [] }] },
  { id: "m04", time: "10:21:06", senderId: "a901", kind: "channel", channel: "Local", text: "Workshop open until 14:00. Bring a radio if you want to try the rooftop link.", reports: [{ reporterId: "old-town", time: "10:21:06", path: [] }, { reporterId: "north", time: "10:21:08", path: ["North Relay"] }] },
  { id: "m05", time: "10:20:31", senderId: "d35a", kind: "advertisement", reports: [{ reporterId: "north", time: "10:20:31", path: ["North Relay"] }] },
  { id: "m06", time: "10:19:45", senderId: "6c90", kind: "direct", text: "Test received. Thanks for checking.", reports: [{ reporterId: "old-town", time: "10:19:45", path: [] }] },
  { id: "m07", time: "10:18:12", senderId: "11d8", kind: "advertisement", reports: [{ reporterId: "north", time: "10:18:12", path: [] }, { reporterId: "river", time: "10:18:14", path: ["Old Town Rooftop"] }] },
  { id: "m08", time: "10:16:42", senderId: "b65c", kind: "channel", channel: "Public", text: "Portable station online. No GPS fix yet.", reports: [{ reporterId: "river", time: "10:16:42", path: [] }] },
  { id: "m09", time: "10:15:10", senderId: "f0a2", kind: "advertisement", reports: [{ reporterId: "river", time: "10:15:10", path: [] }] },
  { id: "m10", time: "10:14:08", senderId: "c4f0", kind: "channel", channel: "Local", text: "West bank coverage looks good near the bridge.", reports: [{ reporterId: "river", time: "10:14:08", path: ["West Bank"] }] },
  { id: "m11", time: "10:12:29", senderId: "6c90", kind: "advertisement", reports: [{ reporterId: "old-town", time: "10:12:29", path: [] }] },
  { id: "m12", time: "10:11:04", senderId: "72be", kind: "channel", channel: "Public", text: "North relay antenna test complete. Back to the normal configuration.", reports: [{ reporterId: "north", time: "10:11:04", path: [] }, { reporterId: "old-town", time: "10:11:06", path: ["Old Town Rooftop"] }] },
  { id: "m13", time: "10:09:03", senderId: "340e", kind: "advertisement", reports: [{ reporterId: "river", time: "10:09:03", path: ["West Bank"] }] },
  { id: "m14", time: "10:07:22", senderId: "11d8", kind: "channel", channel: "Local", text: "East link is hearing the garden sensor again.", reports: [{ reporterId: "north", time: "10:07:22", path: [] }] },
  { id: "m15", time: "10:04:16", senderId: "9ab7", kind: "channel", channel: "Public", text: "Evening net at 18:00. Everyone welcome.", reports: [{ reporterId: "old-town", time: "10:04:16", path: [] }] },
  { id: "m16", time: "09:58:20", senderId: "e2f6", kind: "advertisement", reports: [{ reporterId: "north", time: "09:58:20", path: [] }] },
];
