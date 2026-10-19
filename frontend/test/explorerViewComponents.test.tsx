/**
 * Issues #1039 and #1040 — rendered behaviour of the column chooser and the
 * activity calendar. No network access: both components are fed plain props.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import EventColumnSettings from "../src/components/EventColumnSettings";
import ActivityCalendar from "../src/components/ActivityCalendar";
import { DEFAULT_EVENT_COLUMNS } from "../src/utils/eventColumns";
import type { DecodedEvent } from "../src/api";

describe("EventColumnSettings (#1039)", () => {
  it("stays collapsed until opened", () => {
    render(<EventColumnSettings columns={DEFAULT_EVENT_COLUMNS} onChange={vi.fn()} />);
    const toggle = screen.getByRole("button", { name: /columns/i });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("checkbox")).toBeNull();

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getAllByRole("checkbox")).toHaveLength(DEFAULT_EVENT_COLUMNS.length);
  });

  it("emits the new column list when a column is hidden", () => {
    const onChange = vi.fn();
    render(<EventColumnSettings columns={["seq", "ledger"]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /columns/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Ledger" }));
    expect(onChange).toHaveBeenCalledWith(["seq"]);
  });

  it("disables hiding when only one column is visible", () => {
    render(<EventColumnSettings columns={["seq"]} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /columns/i }));
    expect(screen.getByRole("checkbox", { name: "Seq" }).hasAttribute("disabled")).toBe(true);
  });

  it("moves a column with the arrow buttons", () => {
    const onChange = vi.fn();
    render(<EventColumnSettings columns={["seq", "ledger"]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /columns/i }));
    fireEvent.click(screen.getByRole("button", { name: "Move Ledger earlier" }));
    expect(onChange).toHaveBeenCalledWith(["ledger", "seq"]);
  });

  it("resets to defaults and is disabled while already at defaults", () => {
    const onChange = vi.fn();
    const { rerender } = render(<EventColumnSettings columns={["seq"]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /columns/i }));
    fireEvent.click(screen.getByRole("button", { name: /reset to defaults/i }));
    expect(onChange).toHaveBeenCalledWith(DEFAULT_EVENT_COLUMNS);

    rerender(<EventColumnSettings columns={DEFAULT_EVENT_COLUMNS} onChange={onChange} />);
    expect(
      (screen.getByRole("button", { name: /reset to defaults/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

function ev(seq: number, closed_at: string | null | undefined): DecodedEvent {
  return {
    seq,
    contract_id: "C" + "A".repeat(55),
    function: "transfer",
    ledger: seq,
    description: "",
    raw_topics: [],
    closed_at,
  };
}

describe("ActivityCalendar (#1040)", () => {
  it("links each active day to its first event", () => {
    const now = new Date();
    const todayIso = now.toISOString();
    render(
      <MemoryRouter>
        <ActivityCalendar events={[ev(77, todayIso), ev(70, todayIso)]} />
      </MemoryRouter>,
    );
    const link = screen.getByRole("link", { name: new RegExp(`${now.toISOString().slice(0, 10)}: 2 events`) });
    expect(link.getAttribute("href")).toBe("/event/70");
  });

  it("switches range with the radio buttons", () => {
    render(
      <MemoryRouter>
        <ActivityCalendar events={[ev(1, new Date().toISOString())]} />
      </MemoryRouter>,
    );
    expect(screen.getByRole("radio", { name: "30d" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: "7d" }));
    expect(screen.getByRole("radio", { name: "7d" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getAllByRole("listitem")).toHaveLength(7);
  });

  it("explains that undated events are not on the grid", () => {
    render(
      <MemoryRouter>
        <ActivityCalendar events={[ev(1, undefined), ev(2, null)]} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/2 events without a ledger close time/)).toBeDefined();
  });

  it("shows an empty state when there is no dated activity", () => {
    render(
      <MemoryRouter>
        <ActivityCalendar events={[]} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/no dated activity in the last 30 days/i)).toBeDefined();
  });
});
