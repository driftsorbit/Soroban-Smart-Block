import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import AddressLabelEditor from "./AddressLabelEditor";
import { LABEL_STORAGE_KEY } from "../utils/addressLabels";

const ADDRESS = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7";

describe("AddressLabelEditor", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => cleanup());

  it("saves a label to this browser only and shows it", () => {
    render(<AddressLabelEditor address={ADDRESS} />);
    fireEvent.click(screen.getByRole("button", { name: "Add label" }));
    fireEvent.change(screen.getByLabelText("Label"), { target: { value: "Treasury" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByText("Treasury")).toBeDefined();
    expect(JSON.parse(localStorage.getItem(LABEL_STORAGE_KEY) ?? "{}")).toEqual({ [ADDRESS]: "Treasury" });
  });

  it("shows a validation error and does not store an empty label", () => {
    render(<AddressLabelEditor address={ADDRESS} />);
    fireEvent.click(screen.getByRole("button", { name: "Add label" }));
    fireEvent.change(screen.getByLabelText("Label"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByRole("alert").textContent).toBe("Label cannot be empty.");
    expect(localStorage.getItem(LABEL_STORAGE_KEY)).toBeNull();
  });

  it("erases the label from storage", () => {
    localStorage.setItem(LABEL_STORAGE_KEY, JSON.stringify({ [ADDRESS]: "Treasury" }));
    render(<AddressLabelEditor address={ADDRESS} />);
    expect(screen.getByText("Treasury")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Erase label" }));

    expect(screen.getByText("No private label")).toBeDefined();
    expect(JSON.parse(localStorage.getItem(LABEL_STORAGE_KEY) ?? "{}")).toEqual({});
  });

  it("edits an existing label", () => {
    localStorage.setItem(LABEL_STORAGE_KEY, JSON.stringify({ [ADDRESS]: "Treasury" }));
    render(<AddressLabelEditor address={ADDRESS} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit label" }));
    fireEvent.change(screen.getByLabelText("Label"), { target: { value: "Ops" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByText("Ops")).toBeDefined();
    expect(JSON.parse(localStorage.getItem(LABEL_STORAGE_KEY) ?? "{}")).toEqual({ [ADDRESS]: "Ops" });
  });
});
