import { useId, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList, ComboboxTrigger } from "../../components/ui/combobox";

export interface PacketFilterOption<ID extends string> {
  id: ID;
  name: string;
  searchText?: string;
  detail?: string;
}

// Observers and packet kinds share the same compact, flat selection workflow.
export function PacketFilterSelector<ID extends string>({ label, searchLabel, options, selection, onSelectionChange, renderLabel }: {
  label: string; searchLabel: string; options: PacketFilterOption<ID>[];
  selection: ID[] | null; onSelectionChange: (selection: ID[] | null) => void;
  renderLabel?: (option: PacketFilterOption<ID>) => ReactNode;
}) {
  const { t } = useTranslation();
  const id = useId();
  const selectedIds = new Set(selection ?? options.map(option => option.id));
  const selected = options.filter(option => selectedIds.has(option.id));
  const names = new Map<string, number>();
  options.forEach(option => names.set(option.name, (names.get(option.name) ?? 0) + 1));
  const summary = selection === null ? `${t("common.all")} · ${options.length}` : selected.length === 0 ? t("common.none")
    : t("meshlog.channels.selectionCount", { selected: selected.length, total: options.length });
  return <div className="meshlog-filter-selector">
    <span className="meshlog-channel-label">{label}</span>
    <Combobox<PacketFilterOption<ID>, true> multiple items={options} value={selected}
      itemToStringLabel={option => option.name} itemToStringValue={option => option.id} isItemEqualToValue={(a, b) => a.id === b.id}
      filter={(option, query) => `${option.name} ${option.searchText ?? ""}`.toLowerCase().includes(query.trim().toLowerCase())}
      onInputValueChange={(_, details) => { if (details.isItemPress) details.cancel(); }}
      onValueChange={items => {
        const available = new Set(options.map(option => option.id));
        onSelectionChange([...(selection ?? []).filter(value => !available.has(value)), ...items.map(option => option.id)]);
      }}>
      <ComboboxTrigger className="meshlog-filter-trigger" aria-label={`${label} · ${summary}`}>
        <span className="meshlog-filter-summary">{selection === null || selected.length === 0 ? summary : <>
          <span>{renderLabel ? renderLabel(selected[0]!) : selected[0]!.name}</span>{selected.length > 1 && <span>+{selected.length - 1}</span>}
        </>}</span>
      </ComboboxTrigger>
      <ComboboxContent aria-label={label} className="meshlog-filter-popup">
        <ComboboxInput aria-label={searchLabel} placeholder={searchLabel} />
        <ComboboxEmpty>{options.length ? t("common.noMatches") : t("common.noData")}</ComboboxEmpty>
        <ComboboxList aria-label={label}>{(option: PacketFilterOption<ID>) => {
          const showDetail = names.get(option.name)! > 1 && Boolean(option.detail);
          const descriptionId = `${id}-${option.id}`;
          return <ComboboxItem key={option.id} value={option} aria-label={option.name} aria-describedby={showDetail ? descriptionId : undefined}>
            <span className="meshlog-filter-identity"><span>{renderLabel ? renderLabel(option) : option.name}</span>{showDetail && <code id={descriptionId}>{option.detail}</code>}</span>
          </ComboboxItem>;
        }}</ComboboxList>
        <div className="meshlog-channel-actions"><button type="button" onClick={() => onSelectionChange(null)}>{t("common.all")}</button><button type="button" onClick={() => onSelectionChange([])}>{t("common.deselectAll")}</button></div>
      </ComboboxContent>
    </Combobox>
  </div>;
}
