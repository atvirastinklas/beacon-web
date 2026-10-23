/** Join conditional utility classes without introducing a second styling system. */
export function cn(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}
