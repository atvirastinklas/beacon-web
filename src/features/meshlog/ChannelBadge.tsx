import type { CSSProperties } from "react";

const channelColors = ["primary", "secondary", "green", "warn", "text-normal"] as const;

type ChannelBadgeProps = { channel: string } & (
  { checked?: never; onCheckedChange?: never } |
  { checked: boolean; onCheckedChange: (checked: boolean) => void }
);

export function ChannelBadge(props: ChannelBadgeProps) {
  // A leading # is presentation, not part of this local color key. Preserve
  // casing; don't impose identity rules on the underlying channel filters.
  const name = props.channel.trim().replace(/^#/, "").trim();
  let hash = 5381;
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) + hash + name.charCodeAt(i)) >>> 0;
  const color = `var(--color-${channelColors[hash % channelColors.length]})`;
  const style = { "--meshlog-channel-color": color } as CSSProperties;
  if (props.checked === undefined) return <span className="meshlog-channel-badge" style={style}>#{name}</span>;
  return <label className="meshlog-channel-badge meshlog-channel-toggle" data-state={props.checked ? "checked" : "unchecked"} style={style}>
    <span className="meshlog-channel-check">
      <input type="checkbox" checked={props.checked} onChange={event => props.onCheckedChange(event.target.checked)} />
      <svg className="meshlog-channel-checkmark" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="m3 7 2.5 2.5L11 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </span>
    <span>#{name}</span>
  </label>;
}
