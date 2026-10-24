import { useId, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Combobox, ComboboxCollection, ComboboxContent, ComboboxEmpty, ComboboxGroup, ComboboxInput, ComboboxItem, ComboboxLabel, ComboboxList, ComboboxSeparator, ComboboxTrigger } from "../../components/ui/combobox";
import { ChannelBadge } from "./ChannelBadge";
import type { MeshlogChannel } from "./types";

type ChannelGroup = { value: "known" | "unknown"; items: MeshlogChannel[] };
const channelName = (channel: MeshlogChannel) => `#${channel.name.trim().replace(/^#/, "").trim()}`;

export function ChannelSelector({ channels, selection, onSelectionChange }: {
  channels: MeshlogChannel[];
  // null follows arriving channels; every explicit array is a snapshot.
  selection: string[] | null;
  onSelectionChange: (selection: string[] | null) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const groups = useMemo(() => ([
    { value: "known", items: channels.filter(channel => channel.keyKnown) },
    { value: "unknown", items: channels.filter(channel => !channel.keyKnown) },
  ] satisfies ChannelGroup[]).filter(group => group.items.length > 0), [channels]);
  const selectedIds = new Set(selection ?? channels.map(channel => channel.id));
  const selected = channels.filter(channel => selectedIds.has(channel.id));
  const nameCounts = new Map<string, number>();
  channels.forEach(channel => nameCounts.set(channelName(channel), (nameCounts.get(channelName(channel)) ?? 0) + 1));
  const summary = selection === null ? `${t("common.all")} · ${channels.length}` : selected.length === 0 ? t("common.none")
    : t("meshlog.channels.selectionCount", { selected: selected.length, total: channels.length });
  return <div className="meshlog-channel-selector">
    <span className="meshlog-channel-label">{t("tabs.Channels")}</span>
    <Combobox<MeshlogChannel, true> multiple items={groups} value={selected}
      itemToStringLabel={channelName} itemToStringValue={channel => channel.id} isItemEqualToValue={(a, b) => a.id === b.id}
      filter={(channel, query) => channelName(channel).toLowerCase().includes(query.trim().toLowerCase()) || channel.id.toLowerCase().includes(query.trim().toLowerCase())}
      onInputValueChange={(_, details) => { if (details.isItemPress) details.cancel(); }}
      onValueChange={items => {
        const availableIds = new Set(channels.map(channel => channel.id));
        onSelectionChange([...(selection ?? []).filter(value => !availableIds.has(value)), ...items.map(channel => channel.id)]);
      }}>
      <ComboboxTrigger className="meshlog-channel-trigger" aria-label={`${t("meshlog.channels.select")} · ${summary}`}>
        <span className="meshlog-channel-summary">{selection === null || selected.length === 0 ? summary : <>
          <ChannelBadge channel={selected[0]!.name} />{selected.length > 1 && <span>+{selected.length - 1}</span>}
        </>}</span>
      </ComboboxTrigger>
      <ComboboxContent aria-label={t("tabs.Channels")} className="meshlog-channel-popup">
        <ComboboxInput aria-label={t("meshlog.channels.search")} placeholder={t("meshlog.channels.search")} />
        {groups.length > 0 && <div className="meshlog-channel-groups" role="group" aria-label={t("tabs.Channels")}>
          {groups.map(group => {
            const count = group.items.filter(channel => selectedIds.has(channel.id)).length;
            const allSelected = count === group.items.length;
            const countId = `${id}-${group.value}-count`;
            return <button key={group.value} type="button" aria-label={t(`meshlog.channels.${group.value}`)} aria-describedby={countId}
              aria-pressed={allSelected ? true : count === 0 ? false : "mixed"}
              onClick={() => {
                const ids = new Set(group.items.map(channel => channel.id));
                onSelectionChange(allSelected ? [...selectedIds].filter(value => !ids.has(value)) : [...new Set([...selectedIds, ...ids])]);
              }}>
              <span>{t(group.value === "known" ? "channels.keyKnownOption" : "channels.keyUnknownOption")}</span><span id={countId}>{count} / {group.items.length}</span>
            </button>;
          })}
        </div>}
        <ComboboxEmpty>{channels.length ? t("channels.noMatches") : t("meshlog.channels.empty")}</ComboboxEmpty>
        <ComboboxList aria-label={t("tabs.Channels")}>
          {(group: ChannelGroup, index) => <ComboboxGroup key={group.value} items={group.items}>
            {index > 0 && <ComboboxSeparator />}
            <ComboboxLabel>{t(`meshlog.channels.${group.value}`)}</ComboboxLabel>
            <ComboboxCollection>{(channel: MeshlogChannel) => {
              const duplicate = nameCounts.get(channelName(channel))! > 1;
              const descriptionId = `${id}-${channel.id}`;
              return <ComboboxItem key={channel.id} value={channel} aria-label={channelName(channel)} aria-describedby={duplicate ? descriptionId : undefined}>
                <span className="meshlog-channel-identity"><ChannelBadge channel={channel.name} />{duplicate && <code id={descriptionId}>{channel.id}</code>}</span>
              </ComboboxItem>;
            }}</ComboboxCollection>
          </ComboboxGroup>}
        </ComboboxList>
        <div className="meshlog-channel-actions"><button type="button" onClick={() => onSelectionChange(null)}>{t("common.all")}</button><button type="button" onClick={() => onSelectionChange([])}>{t("common.deselectAll")}</button></div>
      </ComboboxContent>
    </Combobox>
  </div>;
}
