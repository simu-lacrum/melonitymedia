import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Card } from "../card";

describe("Card", () => {
  it("defaults to flat surface (no backdrop-blur)", () => {
    const { container } = render(<Card>x</Card>);
    expect(container.firstChild).not.toHaveClass("backdrop-blur-xl");
  });

  it("applies backdrop-blur only when variant=header", () => {
    const { container } = render(<Card variant="header">x</Card>);
    expect(container.firstChild).toHaveClass("backdrop-blur-xl");
  });

  it("elevated variant keeps shadow but no blur", () => {
    const { container } = render(<Card variant="elevated">x</Card>);
    expect(container.firstChild).not.toHaveClass("backdrop-blur-xl");
  });
});
