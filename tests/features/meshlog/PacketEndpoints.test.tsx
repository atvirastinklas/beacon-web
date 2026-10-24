import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PacketEndpoints } from "../../../src/features/meshlog/PacketEndpoints";

describe("muted Meshlog packet endpoints", () => {
  it.each(["ab", "abcd", "abcdef"])("preserves the actual short identifier %s", value => {
    const view = render(<PacketEndpoints originator={value} target="12" />);
    expect([...view.container.querySelectorAll("code")].map(code => code.textContent)).toEqual([value, "12"]);
    expect(view.container.querySelector(".meshlog-packet-endpoints")).toBeInTheDocument();
    expect(view.container.querySelector("button, input, a, [tabindex]")).toBeNull();
  });

  it("previews long public keys but retains the full value for accessible text and expanded tooltip content", () => {
    const key = "abcdef12".repeat(8);
    const view = render(<PacketEndpoints originator={key} />);
    expect(view.container.querySelector("code")).toHaveTextContent("abcdef12");
    expect(screen.getByText(`Originator: ${key}`)).toHaveClass("sr-only");
    expect(view.container).not.toHaveTextContent("Target");
    view.rerender(<PacketEndpoints target={key} full />);
    expect(screen.getByText(key, { selector: "code" })).toBeInTheDocument();
    expect(screen.getByText("Target")).toBeInTheDocument();
    expect(view.container).not.toHaveTextContent("Originator");
  });

  it("does not invent either endpoint when unavailable", () => {
    const view = render(<PacketEndpoints />);
    expect(view.container).toBeEmptyDOMElement();
  });
});
