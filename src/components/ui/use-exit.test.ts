import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handBack, takesFocus } from "./use-exit";

class FakeElement {
  isConnected = true;
  drawn = true;
  inClosedDialog = false;
  getClientRects() {
    return { length: this.drawn ? 1 : 0 };
  }
  closest(selector: string) {
    return selector === "dialog:not([open])" && this.inClosedDialog ? {} : null;
  }
}

const doc = { body: new FakeElement(), activeElement: null as unknown };

function control(shape: Partial<Pick<FakeElement, "isConnected" | "drawn" | "inClosedDialog">> = {}) {
  return Object.assign(new FakeElement(), shape) as unknown as HTMLElement;
}

beforeEach(() => {
  vi.stubGlobal("HTMLElement", FakeElement);
  vi.stubGlobal("document", doc);
  doc.activeElement = doc.body;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("takesFocus", () => {
  it("takes a control that is in the page, drawn and outside a closed dialog", () => {
    expect(takesFocus(control())).toBe(true);
  });

  it("refuses nothing, the page itself, and what is not an element of the page", () => {
    expect(takesFocus(null)).toBe(false);
    expect(takesFocus(undefined)).toBe(false);
    expect(takesFocus(doc.body as unknown as HTMLElement)).toBe(false);
    expect(takesFocus({ isConnected: true, getClientRects: () => ({ length: 1 }), closest: () => null } as unknown as HTMLElement)).toBe(false);
  });

  it("refuses a control that left the page, is not drawn, or sits in a closed dialog", () => {
    expect(takesFocus(control({ isConnected: false }))).toBe(false);
    expect(takesFocus(control({ drawn: false }))).toBe(false);
    expect(takesFocus(control({ inClosedDialog: true }))).toBe(false);
  });
});

describe("handBack", () => {
  it("gives the focus back to what opened the layer while it can take it", () => {
    const opener = control();
    const instead = vi.fn(() => control());
    expect(handBack(opener, instead)()).toBe(opener);
    expect(instead).not.toHaveBeenCalled();
  });

  it("gives it to the control named instead when the opener went, with the focus left on the page", () => {
    const other = control();
    expect(handBack(control({ isConnected: false }), () => other)()).toBe(other);
    expect(handBack(null, () => other)()).toBe(other);
  });

  it("leaves a focus that already landed elsewhere where it is", () => {
    doc.activeElement = control();
    const instead = vi.fn(() => control());
    expect(handBack(control({ isConnected: false }), instead)()).toBeNull();
    expect(instead).not.toHaveBeenCalled();
  });

  it("reads a focus left inside a closed dialog as left on the page", () => {
    doc.activeElement = control({ inClosedDialog: true });
    const other = control();
    expect(handBack(null, () => other)()).toBe(other);
  });

  it("gives nothing when the control named instead cannot take the focus either", () => {
    expect(handBack(null, () => control({ drawn: false }))()).toBeNull();
    expect(handBack(null, () => null)()).toBeNull();
  });
});
