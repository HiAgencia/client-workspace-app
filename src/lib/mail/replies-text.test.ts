import { describe, expect, it } from "vitest";
import { repliesTally, repliesText } from "./replies-text";

const down = (accountId: string) => ({ accountId });

describe("what a task's possible replies say", () => {
  it("says «and more» only when more arrived than were read", () => {
    expect(repliesText(2, false)).toBe("2 possible replies");
    expect(repliesText(1, false)).toBe("1 possible reply");
    expect(repliesText(2, true)).toBe("2 possible replies and more");
  });

  it("does not take an account that could not be read for more replies", () => {
    expect(repliesTally({ replies: [1, 2], more: [], failures: [] })).toBe("2 possible replies");
    expect(repliesTally({ replies: [1, 2], more: ["a"], failures: [] })).toBe("2 possible replies and more");
    expect(repliesTally({ replies: [1, 2], more: [], failures: [down("a")] })).toBe("2 possible replies, 1 account not read");
    expect(repliesTally({ replies: [1], more: ["b"], failures: [down("a"), down("c")] })).toBe("1 possible reply and more, 2 accounts not read");
  });

  it("counts an account once however many of its reads failed", () => {
    expect(repliesTally({ replies: [1], more: [], failures: [down("a"), down("a")] })).toBe("1 possible reply, 1 account not read");
  });
});
