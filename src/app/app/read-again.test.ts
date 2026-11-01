import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHECK_MS, ROUND_AGE_MS, watchRounds } from "./read-again";


function setUp({ hidden = false } = {}) {
  let lastRound = Date.now();
  let listener: (() => void) | null = null;
  const page = {
    hidden,
    activeElement: null as { matches: (selector: string) => boolean } | null,
    addEventListener: (_: string, handler: () => void) => {
      listener = handler;
    },
    removeEventListener: () => {
      listener = null;
    },
  };
  const rounds = vi.fn(() => {
    lastRound = Date.now();
  });
  const stop = watchRounds(page as unknown as Parameters<typeof watchRounds>[0], () => Date.now() - lastRound, rounds);
  return {
    page,
    rounds,
    stop,
    change: () => listener?.(),
    wrote: () => {
      lastRound = Date.now();
    },
    typing: () => {
      page.activeElement = { matches: () => true };
    },
  };
}

describe("reading again on its own", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads once a round got old, and not before", () => {
    const { rounds } = setUp();
    vi.advanceTimersByTime(ROUND_AGE_MS - CHECK_MS);
    expect(rounds).not.toHaveBeenCalled();
    vi.advanceTimersByTime(CHECK_MS);
    expect(rounds).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(ROUND_AGE_MS);
    expect(rounds).toHaveBeenCalledTimes(2);
  });

  it("does not read again right after a write: a write starts the wait over", () => {
    const { rounds, wrote } = setUp();
    vi.advanceTimersByTime(ROUND_AGE_MS - CHECK_MS);
    wrote();
    vi.advanceTimersByTime(ROUND_AGE_MS - CHECK_MS);
    expect(rounds).not.toHaveBeenCalled();
    vi.advanceTimersByTime(CHECK_MS);
    expect(rounds).toHaveBeenCalledTimes(1);
  });

  it("does not read while the tab is hidden, and reads when it comes back after long enough", () => {
    const { page, rounds, change } = setUp({ hidden: true });
    vi.advanceTimersByTime(ROUND_AGE_MS * 3);
    expect(rounds).not.toHaveBeenCalled();
    page.hidden = false;
    change();
    expect(rounds).toHaveBeenCalledTimes(1);
  });

  it("going to another tab and back reads nothing, and the check that follows a return does not read twice", () => {
    const { page, rounds, change } = setUp();
    page.hidden = true;
    change();
    vi.advanceTimersByTime(CHECK_MS);
    page.hidden = false;
    change();
    expect(rounds).not.toHaveBeenCalled();

    page.hidden = true;
    change();
    vi.advanceTimersByTime(ROUND_AGE_MS);
    page.hidden = false;
    change();
    expect(rounds).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(CHECK_MS);
    expect(rounds).toHaveBeenCalledTimes(1);
  });

  it("leaves a person typing alone, and reads once they stop", () => {
    const { page, rounds, typing } = setUp();
    typing();
    vi.advanceTimersByTime(ROUND_AGE_MS * 2);
    expect(rounds).not.toHaveBeenCalled();
    page.activeElement = null;
    vi.advanceTimersByTime(CHECK_MS);
    expect(rounds).toHaveBeenCalledTimes(1);
  });

  it("reads on coming back even with a field in focus: the person was away", () => {
    const { page, rounds, change, typing } = setUp({ hidden: true });
    typing();
    vi.advanceTimersByTime(ROUND_AGE_MS);
    page.hidden = false;
    change();
    expect(rounds).toHaveBeenCalledTimes(1);
  });

  it("stops watching", () => {
    const { rounds, stop, change } = setUp();
    stop();
    vi.advanceTimersByTime(ROUND_AGE_MS * 2);
    change();
    expect(rounds).not.toHaveBeenCalled();
  });
});
