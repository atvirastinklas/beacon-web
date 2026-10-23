import { vi } from "vitest";

// Vitest selects NumberFlow's SSR entry; jsdom cannot upgrade its custom element.
vi.mock("@number-flow/react", () => ({
  default: ({ value }: { value: number }) => <span>{value}</span>,
}));
