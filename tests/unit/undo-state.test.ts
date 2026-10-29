import { describe, expect, it } from "vitest";
import {
  ExpansionUndoState,
  type UndoRecord,
} from "../../src/content/undo-state";

const target = {} as HTMLInputElement;
const record: UndoRecord = {
  target,
  expectedValue: "Hello there ",
  caret: 12,
  restore: () => undefined,
  inputType: "deleteContentBackward",
};

describe("ExpansionUndoState", () => {
  it("restores eligibility for immediate Backspace or history undo only", () => {
    for (const inputType of ["deleteContentBackward", "historyUndo"]) {
      const state = new ExpansionUndoState();
      state.set(record);
      expect(
        state.takeIfMatches(target, inputType, record.expectedValue, 12),
      ).toBe(record);
    }
  });

  it("clears on any other input or changed field state", () => {
    const state = new ExpansionUndoState();
    state.set(record);
    expect(
      state.takeIfMatches(target, "insertText", record.expectedValue, 12),
    ).toBeUndefined();
    expect(
      state.takeIfMatches(target, "historyUndo", record.expectedValue, 12),
    ).toBeUndefined();

    state.set(record);
    expect(
      state.takeIfMatches(target, "historyUndo", "changed", 12),
    ).toBeUndefined();
  });
});
