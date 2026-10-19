import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import WalletBalances from "./WalletBalances";

const ADDRESS = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7";

vi.mock("../utils/assetLogo", () => ({
  resolveAssetLogo: vi.fn(async () => null),
}));

vi.mock("../api", () => ({
  api: {
    wallet: vi.fn(async () => ({
      events: [],
      horizon_account: {
        id: ADDRESS,
        account_id: ADDRESS,
        sequence: "1",
        balances: [
          { asset_type: "native", balance: "10.0000000" },
          { asset_type: "credit_alphanum4", asset_code: "BIG", asset_issuer: "GA5Z", balance: "250.0000000" },
          { asset_type: "credit_alphanum4", asset_code: "TINY", asset_issuer: "GA5Y", balance: "0.0000100" },
        ],
      },
    })),
  },
}));

function renderBalances() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <WalletBalances address={ADDRESS} />
    </QueryClientProvider>,
  );
}

describe("WalletBalances dust filter", () => {
  afterEach(() => cleanup());

  it("shows every asset by default", async () => {
    renderBalances();
    expect(await screen.findByText("TINY")).toBeDefined();
    expect(screen.getByText("BIG")).toBeDefined();
  });

  it("hides sub-threshold assets when enabled and restores them with Show all", async () => {
    renderBalances();
    await screen.findByText("TINY");

    fireEvent.click(screen.getByRole("checkbox", { name: "Hide possible dust" }));

    await waitFor(() => expect(screen.queryByText("TINY")).toBeNull());
    expect(screen.getByText("BIG")).toBeDefined();
    expect(screen.getByText(/1 balance hidden as possible dust/)).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    expect(await screen.findByText("TINY")).toBeDefined();
  });

  it("shows an error and keeps all balances when the threshold is invalid", async () => {
    renderBalances();
    await screen.findByText("TINY");

    fireEvent.click(screen.getByRole("checkbox", { name: "Hide possible dust" }));
    fireEvent.change(screen.getByLabelText("Dust threshold in asset units"), { target: { value: "-5" } });

    expect(screen.getByRole("alert").textContent).toContain("Threshold cannot be negative.");
    expect(screen.getByText("TINY")).toBeDefined();
  });
});
