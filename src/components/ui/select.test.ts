import { Select as Base } from "@base-ui/react/select";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { dueTimeOptions } from "@/app/app/due-times";
import { Select } from "./select";

function valueText(markup: string): string {
  const found = /class="picker-value"[^>]*>([^<]*)</.exec(markup);
  if (!found) throw new Error(`no value in the markup: ${markup}`);
  return found[1];
}

const GONE = "0b7f6c1e-2f9d-4a55-8f3a-9c1d2e3f4a5b";
const options = [
  { value: "first", label: "First account" },
  { value: "second", label: "Second account" },
];
const read = (value: string | null) => valueText(renderToStaticMarkup(h(Select, { label: "Account", value, options, placeholder: "Pick one", onChange: () => {} })));

describe("the Select's value", () => {
  it("reads the placeholder, never the id, when its value is no longer an option", () => {
    expect(read(GONE)).toBe("Pick one");
  });

  it("reads the option's label when its value is one", () => {
    expect(read("second")).toBe("Second account");
  });

  it("its twin: Base UI given that value directly shows the id, which is what the check above would catch", () => {
    const raw = renderToStaticMarkup(
      h(
        Base.Root,
        { value: GONE, items: options, modal: false },
        h(Base.Trigger, null, h(Base.Value, { className: "picker-value", placeholder: "Pick one" })),
      ),
    );
    expect(valueText(raw)).toBe(GONE);
  });
});

describe("the Select's name", () => {
  const trigger = (markup: string): string => {
    const found = /<[a-z]+\s[^>]*class="picker[ "][^>]*>/.exec(markup);
    if (!found) throw new Error(`no trigger in the markup: ${markup}`);
    return found[0];
  };
  const attribute = (tag: string, name: string): string | null => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1] ?? null;
  const render = (labelledBy?: string) =>
    trigger(renderToStaticMarkup(h(Select, { label: "Account", labelledBy, value: "second", options, placeholder: "Pick one", onChange: () => {} })));

  it("with a visible label, is that label and then the trigger's own value, and carries no aria-label", () => {
    const tag = render("account-label");
    const id = attribute(tag, "id");
    expect(id).toBeTruthy();
    expect(attribute(tag, "aria-labelledby")).toBe(`account-label ${id}`);
    expect(attribute(tag, "aria-label")).toBeNull();
  });

  it("without one, is its aria-label with the value, and points at no label", () => {
    const tag = render();
    expect(attribute(tag, "aria-label")).toBe("Account: Second account");
    expect(attribute(tag, "aria-labelledby")).toBeNull();
  });
});

describe("a task's time in its Select", () => {
  const readTime = (value: string) => valueText(renderToStaticMarkup(h(Select, { label: "Time", value, options: dueTimeOptions(value), onChange: () => {} })));

  it("reads as itself between two half hours, in its order among them", () => {
    expect(readTime("09:17")).toBe("9:17 AM");
    const values = dueTimeOptions("09:17").map((option) => option.value);
    expect(values.slice(values.indexOf("09:00"), values.indexOf("09:30") + 1)).toEqual(["09:00", "09:17", "09:30"]);
  });

  it("offers the half hours alone when its time is one of them, or it has none", () => {
    expect(dueTimeOptions("09:30")).toHaveLength(49);
    expect(dueTimeOptions(null)).toHaveLength(49);
  });

  it("its twin: the half hours alone would read that time as no choice", () => {
    const value = "09:17";
    const markup = renderToStaticMarkup(h(Select, { label: "Time", value, options: dueTimeOptions(null), placeholder: "Pick one", onChange: () => {} }));
    expect(valueText(markup)).toBe("Pick one");
  });
});
