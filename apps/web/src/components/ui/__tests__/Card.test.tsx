import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Card } from "../card";

describe("Card", () => {
  it("renders without crashing", () => {
    const { container } = render(<Card>x</Card>);
    expect(container.firstChild).toBeTruthy();
  });

  it("applies custom className", () => {
    const { container } = render(<Card className="custom-class">x</Card>);
    expect(container.firstChild).toHaveClass("custom-class");
  });
});
