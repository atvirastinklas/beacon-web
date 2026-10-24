import { channels, contacts, messages, reporters } from "./meshlog-fixtures";
import { buildDemoPaths } from "./meshlog-test-paths";
import type { MeshlogData } from "../../../src/features/meshlog/types";
import { PayloadType } from "../../../src/types/enums";

const reporterCodes: Record<string, string> = { "old-town": "a1b2", river: "b2c3", north: "c3d4" };

export const meshlogTestData: MeshlogData = {
  contacts: contacts.map(contact => ({ ...contact, publicKey: contact.id })),
  reporters: reporters.map(reporter => ({ ...reporter, code: reporterCodes[reporter.id]!, publicKey: reporterCodes[reporter.id]!.repeat(16), hashSize: 2, iata: "RIX", status: "online", observerType: "repeater" })),
  channels: channels.map(name => ({ id: name, name, keyKnown: true })),
  messages: messages.map(message => ({
    ...message,
    payloadType: message.kind === "channel" ? PayloadType.GROUP_TEXT : message.kind === "advertisement" ? PayloadType.ADVERT : PayloadType.TEXT,
    senderName: contacts.find(contact => contact.id === message.senderId)!.name,
    channelId: message.channel,
    reports: message.reports.map(report => ({ ...report, observerCode: reporterCodes[report.reporterId], hashSize: 2,
      pathNames: report.path, path: report.path.map(name => contacts.find(contact => contact.name === name)?.id || "?"),
      segments: report.path.map(name => {
        const node = contacts.find(contact => contact.name === name);
        return { code: node?.id || "?", confidence: node ? "high" : "none", nodes: node ? [{ id: node.id, name: node.name, publicKey: node.id }] : [] };
      }),
    })),
  })),
  paths: buildDemoPaths(messages),
};
