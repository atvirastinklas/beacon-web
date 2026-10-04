import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FilterBar } from "../../src/components/FilterBar";

const noop = () => {};
const props = {
  typeOptions: [{ value: "ADVERT", label: "ADVERT" }],
  routeOptions: [{ value: "0", label: "Flood" }],
  observerOptions: [{ value: "o1", label: "YVR" }],
  scopeOptions: [{ value: "s1", label: "#east" }],
  activeTypes: ["ADVERT"],
  activeRoutes: [] as string[],
  activeObservers: [] as string[],
  activeScopes: [] as string[],
  onTypesChange: noop,
  onRoutesChange: noop,
  onObserversChange: noop,
  onScopesChange: noop,
  search: "",
  onSearchChange: noop,
  searchField: "hash" as const,
  onSearchFieldChange: noop,
  onClear: noop,
};

describe("FilterBar", () => {
  it("keeps the English placeholder wording", () => {
    render(<FilterBar {...props} searchField="path" />);
    expect(screen.getByPlaceholderText("Search by latest path...")).toBeInTheDocument();
  });
});
