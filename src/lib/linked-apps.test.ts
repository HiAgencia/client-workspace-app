import { describe, expect, it } from "vitest";
import { linkedApp } from "./linked-apps";

describe("the app a link opens", () => {
  it("reads the well-known services from the address, subdomains included", () => {
    expect(linkedApp("https://github.com/larkspur-bakery/website/pull/48")).toBe("github");
    expect(linkedApp("https://gist.github.com/someone/abc")).toBe("github");
    expect(linkedApp("https://www.figma.com/design/q7RkLm2XvT9bWc4NsYp1Ha/Larkspur-homepage")).toBe("figma");
    expect(linkedApp("https://www.notion.so/team/Roadmap-123")).toBe("notion");
    expect(linkedApp("https://studio.notion.site/Brief-123")).toBe("notion");
    expect(linkedApp("https://agency.slack.com/archives/C01")).toBe("slack");
    expect(linkedApp("https://youtu.be/abc")).toBe("youtube");
    expect(linkedApp("https://m.youtube.com/watch?v=abc")).toBe("youtube");
    expect(linkedApp("https://meet.google.com/abc-defg-hij")).toBe("meet");
    expect(linkedApp("https://analytics.google.com/analytics/web/")).toBe("analytics");
    expect(linkedApp("https://drive.google.com/drive/folders/1a")).toBe("drive");
    expect(linkedApp("https://calendar.google.com/calendar/r")).toBe("calendar");
    expect(linkedApp("https://mail.google.com/mail/u/0/#inbox")).toBe("gmail");
  });

  it("tells Docs, Sheets and Slides apart on their one host, by the path", () => {
    expect(linkedApp("https://docs.google.com/document/d/1Kx9/edit")).toBe("docs");
    expect(linkedApp("https://docs.google.com/spreadsheets/d/1Kx9/edit")).toBe("sheets");
    expect(linkedApp("https://docs.google.com/presentation/d/1Kx9/edit")).toBe("slides");
    expect(linkedApp("https://docs.google.com/forms/d/1Kx9/viewform")).toBeNull();
  });

  it("leaves a plain link for an address that only looks like one, another scheme, or no address", () => {
    expect(linkedApp("https://github.com.example.net/pull/1")).toBeNull();
    expect(linkedApp("https://notgithub.com/pull/1")).toBeNull();
    expect(linkedApp("https://docs.example/brief")).toBeNull();
    expect(linkedApp("https://constructor/")).toBeNull();
    expect(linkedApp("mailto:maya@larkspur.example")).toBeNull();
    expect(linkedApp("not an address")).toBeNull();
  });
});
