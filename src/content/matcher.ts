import type { Settings, Snippet } from "../shared/schema";
import {
  findLongestTriggerSuffix,
  type TriggerIndex,
} from "../shared/trigger-index";
import type { CaretText } from "./editable-dom";
import { rangeForSuffix } from "./editable-dom";

export type MatchPhase = "beforeinput" | "input";

export function isWordBoundary(previousCharacter: string | undefined): boolean {
  return (
    previousCharacter === undefined || /^[\s\p{P}]$/u.test(previousCharacter)
  );
}

export type ExpansionMatch = {
  snippet: Snippet;
  start: number;
  end: number;
  typedTrigger: string;
  delimiter: string;
  delimiterInValue: boolean;
};

type MatchInput = {
  value: string;
  selectionStart: number;
  selectionEnd: number;
  inputType: string;
  data: string | null;
  phase: MatchPhase;
  settings: Pick<Settings, "mode" | "caseSensitive">;
  index: TriggerIndex;
};

export type ContentEditableMatch = {
  snippet: Snippet;
  range: Range;
  typedTrigger: string;
  delimiter: string;
  delimiterInValue: boolean;
};

export function findExpansionMatch(
  input: MatchInput,
): ExpansionMatch | undefined {
  if (input.selectionStart !== input.selectionEnd) return undefined;

  if (input.settings.mode === "delimiter") {
    return findDelimiterMatch(input);
  }

  return findImmediateMatch(input);
}

function findDelimiterMatch(input: MatchInput): ExpansionMatch | undefined {
  const delimiter = getDelimiter(input.inputType, input.data);
  if (!delimiter) return undefined;

  const caret = input.selectionStart;
  const beforeCaret = input.value.slice(Math.max(0, caret - 64), caret);
  const textToMatch =
    input.phase === "input"
      ? beforeCaret.slice(0, -delimiter.length)
      : beforeCaret;
  const snippet = findLongestTriggerSuffix(
    textToMatch,
    input.index,
    input.settings.caseSensitive,
  );
  if (!snippet) return undefined;

  const end = input.phase === "beforeinput" ? caret : caret - delimiter.length;
  const start = end - snippet.trigger.length;
  if (!isWordBoundary(input.value[start - 1])) return undefined;
  const typedTrigger = input.value.slice(start, end);
  return {
    snippet,
    start,
    end,
    typedTrigger,
    delimiter,
    delimiterInValue: input.phase === "input",
  };
}

function findImmediateMatch(input: MatchInput): ExpansionMatch | undefined {
  if (input.inputType !== "insertText" || !input.data) return undefined;
  const caret = input.selectionStart;
  const beforeCaret = input.value.slice(Math.max(0, caret - 64), caret);
  const candidate =
    input.phase === "beforeinput" ? `${beforeCaret}${input.data}` : beforeCaret;
  const snippet = findLongestTriggerSuffix(
    candidate,
    input.index,
    input.settings.caseSensitive,
  );
  if (!snippet) return undefined;

  const end = input.phase === "beforeinput" ? caret + input.data.length : caret;
  const start = end - snippet.trigger.length;
  if (!isWordBoundary(input.value[start - 1])) return undefined;
  const typedTrigger =
    input.phase === "beforeinput"
      ? `${input.value.slice(start, caret)}${input.data}`
      : input.value.slice(start, end);
  return {
    snippet,
    start,
    end,
    typedTrigger,
    delimiter: "",
    delimiterInValue: false,
  };
}

export function getDelimiter(inputType: string, data: string | null): string {
  if (inputType === "insertLineBreak" || inputType === "insertParagraph")
    return "\n";
  if (
    inputType === "insertText" &&
    (data === " " || data === "\t" || data === "\n")
  ) {
    return data;
  }
  return "";
}

export function findContentEditableMatch(
  reading: CaretText,
  input: Pick<
    MatchInput,
    "inputType" | "data" | "phase" | "settings" | "index"
  >,
): ContentEditableMatch | undefined {
  const delimiter =
    input.settings.mode === "delimiter"
      ? getDelimiter(input.inputType, input.data)
      : "";
  if (input.settings.mode === "delimiter" && !delimiter) return undefined;
  if (
    input.settings.mode === "immediate" &&
    (input.inputType !== "insertText" || !input.data)
  ) {
    return undefined;
  }

  const suffixText =
    input.phase === "input" && delimiter
      ? reading.text.slice(0, -delimiter.length)
      : reading.text;
  const candidate =
    input.settings.mode === "immediate" && input.phase === "beforeinput"
      ? `${suffixText}${input.data ?? ""}`
      : suffixText;
  const snippet = findLongestTriggerSuffix(
    candidate,
    input.index,
    input.settings.caseSensitive,
  );
  if (!snippet) return undefined;

  const triggerStart = candidate.length - snippet.trigger.length;
  const previousCharacter =
    triggerStart > 0 ? candidate[triggerStart - 1] : reading.precedingCharacter;
  if (!isWordBoundary(previousCharacter)) return undefined;

  const addedLength =
    input.settings.mode === "immediate" && input.phase === "beforeinput"
      ? (input.data?.length ?? 0)
      : 0;
  const existingTriggerLength = snippet.trigger.length - addedLength;
  const delimiterUnits =
    input.phase === "input" && delimiter ? delimiter.length : 0;
  const range = rangeForSuffix(reading, existingTriggerLength, delimiterUnits);
  if (!range) return undefined;

  const typedTrigger =
    input.settings.mode === "immediate" && input.phase === "beforeinput"
      ? `${existingTriggerLength > 0 ? reading.text.slice(-existingTriggerLength) : ""}${input.data ?? ""}`
      : input.phase === "input" && delimiter
        ? reading.text.slice(
            -delimiter.length - snippet.trigger.length,
            -delimiter.length,
          )
        : reading.text.slice(-snippet.trigger.length);

  return {
    snippet,
    range,
    typedTrigger,
    delimiter,
    delimiterInValue: Boolean(delimiter && input.phase === "input"),
  };
}
