import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PortfolioSnapshots from "./PortfolioSnapshots";
import { snapshotStorageKey } from "../utils/valueSnapshots";

const ADDRESS = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7";

const rate = vi.hoisted(() => ({ value: null as number | null }));

vi.mock("../utils/exchangeRate", () => ({
  getUsdRate: vi.fn(async () => rate.value),
}));

vi.mock("../api", () => ({
  api: {
    wallet: vi.fn(async () => ({
      events: [],
      horizon_account: {
        id: ADDRESS,
        account_id: ADDRESS,
        sequence: "1",
        balances: [{ asset_type: "native", balance: "40.0000000" }],
      },
    })),
  },
}));

function renderWithClient() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PortfolioSnapshots address={ADDRESS} />
    </QueryClientProvider>,
  );
}

describe("PortfolioSnapshots", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => cleanup());

  it("records nothing until the user clicks Record snapshot", () => {
    renderWithClient();
    expect(screen.getByText("No snapshots recorded yet.")).toBeDefined();
    expect(localStorage.getItem(snapshotStorageKey(ADDRESS))).toBeNull();
  });

  it("records a valued snapshot with its source when a rate is available", async () => {
    rate.value = 0.5;
    renderWithClient();
    const button = await screen.findByRole("button", { name: "Record snapshot" });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);

    expect(await screen.findByText(/40.0000000 XLM · \$20.00 USD/)).toBeDefined();
    expect(screen.getByText(/source: horizon\+coingecko/)).toBeDefined();
    expect(JSON.parse(localStorage.getItem(snapshotStorageKey(ADDRESS)) ?? "[]")).toHaveLength(1);
  });

  it("shows an explicit unavailable state when no rate is returned", async () => {
    rate.value = null;
    renderWithClient();
    const button = await screen.findByRole("button", { name: "Record snapshot" });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);

    expect(await screen.findByText("40.0000000 XLM · USD value unavailable")).toBeDefined();
    expect(screen.getByText(/Unavailable — No XLM\/USD rate/)).toBeDefined();
  });

  it("clears stored history", async () => {
    rate.value = 1;
    renderWithClient();
    const button = await screen.findByRole("button", { name: "Record snapshot" });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);
    fireEvent.click(await screen.findByRole("button", { name: "Clear history" }));

    expect(screen.getByText("No snapshots recorded yet.")).toBeDefined();
    expect(JSON.parse(localStorage.getItem(snapshotStorageKey(ADDRESS)) ?? "[]")).toEqual([]);
  });
});
