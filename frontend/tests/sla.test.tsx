import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SlaBadge } from "@/components/ui/SlaBadge";
import type { SlaSummary } from "@/lib/types";

describe("SlaBadge", () => {
  it('renders "Just submitted" for a fresh claim', () => {
    render(<SlaBadge sla={{ level: "fresh", ageDays: 0, thresholdDays: 5 }} />);
    expect(screen.getByText("Just submitted")).toBeInTheDocument();
  });

  it('renders "Aging: 4d" with the warning tone for an aging claim', () => {
    render(<SlaBadge sla={{ level: "aging", ageDays: 4, thresholdDays: 5 }} />);
    const badge = screen.getByText("Aging: 4d");
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain("bg-tertiary-container");
  });

  it('renders "Overdue: 12d" with the error tone for a breached claim', () => {
    render(<SlaBadge sla={{ level: "breached", ageDays: 12, thresholdDays: 7 }} />);
    const badge = screen.getByText("Overdue: 12d");
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain("bg-error");
  });

  it("shows the SLA threshold in a tooltip", () => {
    render(<SlaBadge sla={{ level: "aging", ageDays: 4, thresholdDays: 5 }} />);
    expect(screen.getByText("Threshold is 5d")).toBeInTheDocument();
  });
});
