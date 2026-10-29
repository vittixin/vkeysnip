export type UndoRecord = {
  target: HTMLElement;
  expectedValue: string;
  caret: number | string;
  restore: () => void;
  inputType: "deleteContentBackward" | "historyUndo";
};

export class ExpansionUndoState {
  private record: UndoRecord | undefined;

  set(record: UndoRecord): void {
    this.record = record;
  }

  takeIfMatches(
    target: HTMLElement,
    inputType: string,
    value: string,
    caret: number | string | undefined,
  ): UndoRecord | undefined {
    const record = this.record;
    this.record = undefined;
    if (
      !record ||
      (inputType !== "deleteContentBackward" && inputType !== "historyUndo") ||
      record.target !== target ||
      record.expectedValue !== value ||
      record.caret !== caret
    ) {
      return undefined;
    }
    return record;
  }

  clear(): void {
    this.record = undefined;
  }
}
