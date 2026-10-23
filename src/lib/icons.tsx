import type { ReactNode, SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };
const make = (paths: ReactNode, name: string) => {
  const Icon = ({ size = 16, ...rest }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor"
      strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable={false} {...rest}>
      {paths}
    </svg>
  );
  Icon.displayName = name;
  return Icon;
};

export const ArrowDown = make(<path d="M8 3v10M4 9l4 4 4-4" />, "ArrowDown");
export const Search = make(<><circle cx="7" cy="7" r="4.25" /><path d="m10.25 10.25 3 3" /></>, "Search");
export const X = make(<path d="m4.5 4.5 7 7M11.5 4.5l-7 7" />, "X");
