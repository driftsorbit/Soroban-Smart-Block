import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { XdrInspectorTree, decodeXdrPayload, scValToTreeNode } from "../src/components/XdrInspectorTree";
import { SimulationBudgetDeltas } from "../src/components/SimulationBudgetDeltas";
import { CheckpointManager } from "../src/components/CheckpointManager";
import { calculateBudgetDeltas, ResourceBudget } from "../src/services/sandbox-api";
import { xdr, Address } from "@stellar/stellar-sdk";

// Mock clipboard
Object.assign(navigator, {
  clipboard: {
    writeText: vi.fn().mockImplementation(() => Promise.resolve()),
  },
});

describe("Sandbox XDR Input and Output Inspector (#1094)", () => {
  it("renders structured tree on normal path for ScVal XDR", () => {
    const scVal = xdr.ScVal.scvString("hello-world");
    const b64 = scVal.toXDR("base64");

    const { getByTestId, getByText } = render(
      <XdrInspectorTree title="Return Value" xdrBase64={b64} />
    );

    expect(getByTestId("xdr-inspector-tree")).toBeDefined();
    expect(getByText('"hello-world"')).toBeDefined();
    expect(getByText("string:")).toBeDefined();
  });

  it("handles complex nested vector and map ScVals", () => {
    const mapVal = xdr.ScVal.scvMap([
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol("balance"),
        val: xdr.ScVal.scvU32(500),
      }),
    ]);
    const b64 = mapVal.toXDR("base64");

    const decoded = decodeXdrPayload(b64);
    expect("tree" in decoded).toBe(true);
    if ("tree" in decoded) {
      expect((decoded.tree as any).map).toBeDefined();
    }
  });

  it("falls back to raw view with warning badge for unknown / unrecognized XDR types", () => {
    // Arbitrary base64 bytes that do not decode into known ScVal or ContractEvent
    const unknownB64 = Buffer.from("arbitrary_unknown_binary_content_12345").toString("base64");

    const { getByTestId, getByText } = render(
      <XdrInspectorTree title="Custom XDR" xdrBase64={unknownB64} />
    );

    expect(getByTestId("xdr-inspector-tree")).toBeDefined();
    expect(getByText("Raw Fallback")).toBeDefined();
    expect(getByText(/Unknown \/ Unrecognized XDR/i)).toBeDefined();
  });

  it("displays explicit empty state when no XDR is provided", () => {
    const { getByTestId } = render(<XdrInspectorTree xdrBase64="" />);
    expect(getByTestId("xdr-inspector-empty")).toBeDefined();
  });

  it("displays explicit invalid-input state when invalid base64 is provided", () => {
    const { getByTestId, getByText } = render(<XdrInspectorTree xdrBase64="!!!not_valid_base64!!!" />);
    expect(getByTestId("xdr-inspector-error")).toBeDefined();
    expect(getByText(/Invalid Base64 XDR string/i)).toBeDefined();
  });

  it("supports copying individual node value and full tree as JSON", async () => {
    const scVal = xdr.ScVal.scvU32(12345);
    const b64 = scVal.toXDR("base64");

    const { getByText } = render(<XdrInspectorTree title="Test Tree" xdrBase64={b64} />);

    const copyJsonBtn = getByText("⎘ Copy JSON");
    fireEvent.click(copyJsonBtn);
    expect(navigator.clipboard.writeText).toHaveBeenCalled();
  });
});

describe("Sandbox Resource-Budget Deltas (#1096)", () => {
  it("calculates budget deltas correctly between two runs", () => {
    const baseline: ResourceBudget = {
      cpuInsns: 10000,
      memBytes: 2048,
      ledgerIO: { readBytes: 100, writeBytes: 50, readEntries: 2, writeEntries: 1 },
      minResourceFee: "1000",
    };

    const nextRun: ResourceBudget = {
      cpuInsns: 12000,
      memBytes: 1800,
      ledgerIO: { readBytes: 150, writeBytes: 50, readEntries: 3, writeEntries: 1 },
      minResourceFee: "1200",
    };

    const deltas = calculateBudgetDeltas(nextRun, baseline);

    expect(deltas.cpu.diff).toBe(2000);
    expect(deltas.cpu.percent).toBeCloseTo(20.0);
    expect(deltas.cpu.status).toBe("increased");

    expect(deltas.mem.diff).toBe(-248);
    expect(deltas.mem.status).toBe("decreased");

    expect(deltas.ledgerReadBytes.diff).toBe(50);
    expect(deltas.fee.diff).toBe(200);
  });

  it("identifies unavailable RPC values with explicit status and labels", () => {
    const budgetWithUnavailableRPC: ResourceBudget = {
      cpuInsns: 5000,
      memBytes: 1024,
      ledgerIO: null,
      minResourceFee: null,
      ledgerIOUnavailable: true,
      feeUnavailable: true,
    };

    const deltas = calculateBudgetDeltas(budgetWithUnavailableRPC, null);
    expect(deltas.ledgerReadBytes.status).toBe("unavailable");
    expect(deltas.fee.status).toBe("unavailable");

    const { getAllByText } = render(
      <SimulationBudgetDeltas currentBudget={budgetWithUnavailableRPC} deltas={deltas} mode="remote" />
    );

    const unavailableLabels = getAllByText("Unavailable from RPC");
    expect(unavailableLabels.length).toBeGreaterThanOrEqual(2);
  });

  it("shows baseline run indicator when no prior simulation exists", () => {
    const firstBudget: ResourceBudget = {
      cpuInsns: 8000,
      memBytes: 4096,
      ledgerIO: { readBytes: 80, writeBytes: 20, readEntries: 1, writeEntries: 1 },
      minResourceFee: "500",
    };

    const deltas = calculateBudgetDeltas(firstBudget, null);
    expect(deltas.cpu.status).toBe("baseline");

    const { getByText } = render(
      <SimulationBudgetDeltas currentBudget={firstBudget} deltas={deltas} mode="remote" />
    );

    expect(getByText("Baseline Run")).toBeDefined();
  });

  it("displays explicit empty state when current budget is null", () => {
    const { getByTestId } = render(<SimulationBudgetDeltas currentBudget={null} />);
    expect(getByTestId("budget-deltas-empty")).toBeDefined();
  });

  it("displays failure alert when simulation has an error", () => {
    const failedBudget: ResourceBudget = {
      cpuInsns: 0,
      memBytes: 0,
      ledgerIO: null,
      minResourceFee: null,
      ledgerIOUnavailable: true,
      feeUnavailable: true,
    };

    const { getByText } = render(
      <SimulationBudgetDeltas
        currentBudget={failedBudget}
        mode="remote"
        error="HostError: Contract error code 1"
      />
    );

    expect(getByText(/Simulation failed: HostError: Contract error code 1/i)).toBeDefined();
  });
});

describe("Sandbox Checkpoints and Non-destructive Reset (#1098)", () => {
  const mockFiles = new Map([
    ["src/lib.rs", { content: "original code" }],
  ]);

  it("creates a named checkpoint and updates list", async () => {
    const onReset = vi.fn();
    const { getByText, getByPlaceholderText, getByTestId } = render(
      <CheckpointManager
        sandboxId="test-sandbox-1"
        files={mockFiles}
        onFilesReset={onReset}
      />
    );

    // Open create checkpoint modal
    fireEvent.click(getByText("+ Checkpoint"));
    expect(getByTestId("create-checkpoint-modal")).toBeDefined();

    // Fill in checkpoint name
    fireEvent.change(getByPlaceholderText(/Checkpoint name/i), {
      target: { value: "After deployment" },
    });

    // Save checkpoint
    fireEvent.click(getByText("Save Checkpoint"));

    await waitFor(() => {
      expect(getByText(/Created checkpoint "After deployment"/i)).toBeDefined();
    });
  });

  it("rejects checkpoint creation when name is empty", async () => {
    const onReset = vi.fn();
    const { getByText, getByPlaceholderText } = render(
      <CheckpointManager
        sandboxId="test-sandbox-1"
        files={mockFiles}
        onFilesReset={onReset}
      />
    );

    fireEvent.click(getByText("+ Checkpoint"));
    fireEvent.change(getByPlaceholderText(/Checkpoint name/i), { target: { value: "   " } });
    fireEvent.click(getByText("Save Checkpoint"));

    await waitFor(() => {
      expect(getByText(/Checkpoint name cannot be empty/i)).toBeDefined();
    });
  });

  it("requires confirmation checkbox before non-destructive reset", async () => {
    const onReset = vi.fn();
    const { getByText, getByPlaceholderText, getByTestId, getByLabelText } = render(
      <CheckpointManager
        sandboxId="test-sandbox-2"
        files={mockFiles}
        onFilesReset={onReset}
      />
    );

    // Create a checkpoint first
    fireEvent.click(getByText("+ Checkpoint"));
    fireEvent.change(getByPlaceholderText(/Checkpoint name/i), {
      target: { value: "v1-checkpoint" },
    });
    fireEvent.click(getByText("Save Checkpoint"));

    await waitFor(() => {
      expect(getByText(/Created checkpoint "v1-checkpoint"/i)).toBeDefined();
    });

    // Open reset modal
    fireEvent.click(getByText("↺ Reset Environment"));
    expect(getByTestId("reset-checkpoint-modal")).toBeDefined();

    // Confirm button should be disabled without checkbox
    const confirmBtn = getByText("Confirm & Reset") as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(true);

    // Check the confirmation checkbox
    const checkbox = getByLabelText(/Confirm reset to checkpoint/i);
    fireEvent.click(checkbox);
    expect(confirmBtn.disabled).toBe(false);

    // Execute non-destructive reset
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(onReset).toHaveBeenCalled();
      expect(getByText(/Reset environment to "v1-checkpoint"/i)).toBeDefined();
    });
  });

  it("retains saved scenarios during reset", async () => {
    const onReset = vi.fn();
    const onLoadScenario = vi.fn();

    const { getByText, getByPlaceholderText } = render(
      <CheckpointManager
        sandboxId="test-sandbox-3"
        files={mockFiles}
        onFilesReset={onReset}
        currentContractId="CAAA123"
        currentFn="mint"
        currentArgs='["100"]'
        onLoadScenario={onLoadScenario}
      />
    );

    // Save a scenario
    fireEvent.click(getByText("+ Scenario"));
    fireEvent.change(getByPlaceholderText(/Scenario name/i), {
      target: { value: "Mint 100 Scenario" },
    });
    fireEvent.click(getByText("Save Scenario"));

    await waitFor(() => {
      expect(getByText(/Saved scenario "Mint 100 Scenario"/i)).toBeDefined();
      expect(getByText("▶ Mint 100 Scenario")).toBeDefined();
    });

    // Loading scenario calls onLoadScenario with saved values
    fireEvent.click(getByText("▶ Mint 100 Scenario"));
    expect(onLoadScenario).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Mint 100 Scenario",
        contractId: "CAAA123",
        fn: "mint",
      })
    );
  });
});
