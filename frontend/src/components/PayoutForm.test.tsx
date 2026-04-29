import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PayoutForm } from "./PayoutForm";

const bankAccounts = [
  {
    id: "bank-1",
    label: "Primary",
    bank_name: "HDFC Bank",
    account_number: "****4321",
    ifsc_code: "HDFC0001234",
  },
];

describe("PayoutForm", () => {
  it("uses a full-width card class so the stacked layout fills the row", () => {
    render(
      <PayoutForm
        bankAccounts={bankAccounts}
        availableBalancePaise={105000}
        isSubmitting={false}
        submissionError=""
        onSubmit={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    const submitButton = screen.getByRole("button", { name: "Create payout" });
    const form = submitButton.closest("form");

    expect(form).toHaveClass("w-full");
  });

  it("blocks submission when the requested amount exceeds available balance", async () => {
    const user = userEvent.setup();

    render(
      <PayoutForm
        bankAccounts={bankAccounts}
        availableBalancePaise={105000}
        isSubmitting={false}
        submissionError=""
        onSubmit={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    const amountInput = screen.getByRole("spinbutton", { name: "Amount in INR" });
    await user.clear(amountInput);
    await user.type(amountInput, "2000");

    expect(screen.getByText(/Requested amount is higher than available balance/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create payout" })).toBeDisabled();
  });
});