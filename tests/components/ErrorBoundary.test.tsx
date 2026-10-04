import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ErrorBoundary } from "../../src/components/ErrorBoundary";
import { CloseButton } from "../../src/components/CloseButton";
import i18n from "../../src/i18n";
import { fireEvent } from "@testing-library/react";

function Boom({ message }: { message: string }): never {
  throw new Error(message);
}

describe("ErrorBoundary", () => {
  it("shows the English fallback", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<ErrorBoundary><Boom message="bad" /></ErrorBoundary>);
    expect(screen.getByText("Something went wrong rendering this view.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "try again" })).toBeInTheDocument();
  });

});

describe("ErrorBoundary recovery", () => {
  it("offers a reload for Safari's failed module import", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await i18n.changeLanguage("en");
    render(<ErrorBoundary><Boom message="Importing a module script failed." /></ErrorBoundary>);
    expect(screen.getByRole("button", { name: "reload" })).toBeInTheDocument();
  });

  it("clears the error when its reset key changes", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await i18n.changeLanguage("en");
    const { rerender } = render(<ErrorBoundary resetKey="Map"><Boom message="bad" /></ErrorBoundary>);
    rerender(<ErrorBoundary resetKey="Packets"><p>packets</p></ErrorBoundary>);
    expect(screen.getByText("packets")).toBeInTheDocument();
  });
});

describe("CloseButton", () => {
  it("calls its handler when pressed", () => {
    const onClose = vi.fn();
    render(<CloseButton onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
