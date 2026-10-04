import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SplashScreen } from "../../src/components/SplashScreen";

describe("SplashScreen", () => {
  it("shows the product tagline", () => {
    sessionStorage.clear();
    render(<SplashScreen />);
    expect(screen.getByText("MeshCore Network Analyzer")).toBeInTheDocument();
  });
});
