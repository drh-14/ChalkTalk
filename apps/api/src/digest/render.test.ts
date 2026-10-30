import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { renderDigest } from "./render.js";

const base = {
  courseName: "Calculus <101>",
  activityDate: "2026-10-20",
  courseUrl: "https://app.example.edu/courses/one",
  counts: { post: 2, answer: 1, followup: 1 },
  items: [
    {
      title: "Integration <help>",
      url: "https://app.example.edu/courses/one/posts/two",
      body: "A **bold** answer\n\n- First\n- Second",
    },
  ],
};

describe("digest email rendering", () => {
  it("identifies only CID images retained in the rendered message", async () => {
    const image = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 3,
        background: "red",
      },
    })
      .png()
      .toBuffer();
    const result = await renderDigest({
      ...base,
      items: [
        {
          ...base.items[0],
          images: Array.from({ length: 6 }, (_, index) => ({
            id: `image-${index}`,
            filename: `image-${index}.png`,
            url: `https://app.example.edu/images/${index}`,
            sizeBytes: image.length,
            read: async () => image,
          })),
        },
      ],
    });
    expect(result.attachments.map((attachment) => attachment.sourceId)).toEqual(
      ["image-0", "image-1", "image-2", "image-3", "image-4"],
    );
    expect(result.html).toContain("View image: image-5.png");
    for (const attachment of result.attachments)
      expect(result.html).toContain(`cid:${attachment.cid}`);
  });
  it("shows the activity date without a UTC suffix in both email headings", async () => {
    const result = await renderDigest(base);
    expect(result.html).toContain(
      "<h1>Calculus &lt;101&gt; activity for 2026-10-20</h1>",
    );
    expect(
      result.text.startsWith("Calculus <101> activity for 2026-10-20\n"),
    ).toBe(true);
  });
  it("presents linked titles and each activity's formatted body without kind prefixes", async () => {
    const result = await renderDigest(base);
    expect(result.html).toContain("<strong>bold</strong>");
    expect(result.html).toContain("<li>First</li>");
    expect(result.html).toContain("Integration &lt;help&gt;</a>");
    expect(result.html).not.toContain("post:");
    expect(result.text).toContain("A bold answer");
    expect(result.text).toContain("2 posts · 1 answer · 1 followup");
    expect(result.text).not.toContain("**");
    expect(result.html).not.toContain("Read more");
  });
  it("preserves safe body links and separates table cells in plain text", async () => {
    const result = await renderDigest({
      ...base,
      items: [
        {
          ...base.items[0],
          body: "[Read the notes](https://example.edu/notes)\n\n| First | Second |\n| --- | --- |\n| 1 | 2 |",
        },
      ],
    });
    expect(result.text).toContain("Read the notes (https://example.edu/notes)");
    expect(result.text).toContain("First | Second");
    expect(result.text).toContain("1 | 2");
    expect(result.text).not.toContain("12");
  });
  it("separates every supported block from adjacent plain content", async () => {
    const result = await renderDigest({
      ...base,
      items: [
        {
          ...base.items[0],
          body: "Before<p>After</p><h1>First</h1><h2>Second</h2><h3>Third</h3><h4>Step</h4><p>Apply the rule</p><pre>  code\n  stays</pre>Tail<blockquote>Quote</blockquote>Next<ul><li>Alpha</li><li>Beta</li></ul>End<table><tbody><tr><td>1</td><td>2</td></tr><tr><td>3</td><td>4</td></tr></tbody></table>Finish",
        },
      ],
    });
    expect(result.text).toMatch(/Before\s+After/);
    expect(result.text).toMatch(
      /After\s+First\s+Second\s+Third\s+Step\s+Apply the rule/,
    );
    expect(result.text).toMatch(/stays\s+Tail\s+Quote\s+Next/);
    expect(result.text).toMatch(/Next\s+Alpha\s+Beta\s+End/);
    expect(result.text).toMatch(/End\s+1 \| 2\s+3 \| 4\s+Finish/);
    expect(result.text).not.toContain("StepApply");

    const code = await renderDigest({
      ...base,
      items: [{ ...base.items[0], body: "```\n  code\n  stays\n```" }],
    });
    expect(code.text).toContain("  code\n  stays");
  });
  it("keeps task states and bounded ordered-list starts without controls", async () => {
    const result = await renderDigest({
      ...base,
      items: [
        {
          ...base.items[0],
          body: '- [x] Done\n- [ ] Later\n\n3. Third\n4. Fourth\n\n<ol start="999999999" onclick="bad()"><li>Unsafe start</li></ol><input type="checkbox" checked>',
        },
      ],
    });
    expect(result.html).toContain("[x] Done");
    expect(result.html).toContain("[ ] Later");
    expect(result.html).toContain('<ol start="3">');
    expect(result.html).not.toContain('start="999999999"');
    expect(result.html).not.toMatch(/<input|onclick/);
    expect(result.text).toContain("[x] Done");
    expect(result.text).toContain("[ ] Later");
    expect(result.text).toContain("3. Third");
    expect(result.text).toContain("4. Fourth");
    expect(result.text).toContain("1. Unsafe start");
  });
  it("clips source only between complete UTF-8 code points", async () => {
    for (const splitBytes of [1, 2, 3]) {
      const comment = `A<!--${"x".repeat(128 * 1024 - splitBytes - 8)}-->`;
      const result = await renderDigest({
        ...base,
        items: [{ ...base.items[0], body: comment + "😀 omitted" }],
      });
      expect(result.html).toContain("<p>A</p>");
      expect(result.html).not.toContain("�");
      expect(result.text).not.toContain("�");
      expect(result.html).not.toContain("😀");
      expect(result.html).toContain("Read more</a>");
    }

    const whole = `A<!--${"x".repeat(128 * 1024 - 4 - 8)}-->😀`;
    const complete = await renderDigest({
      ...base,
      items: [{ ...base.items[0], body: whole }],
    });
    expect(complete.html).toContain("A😀");
    expect(complete.html).not.toContain("Read more");
  });
  it("signals formatted Unicode source clipping only beyond the byte boundary", async () => {
    const prefix = "**Visible 😀**";
    const completeBody =
      prefix + " ".repeat(128 * 1024 - Buffer.byteLength(prefix));
    const complete = await renderDigest({
      ...base,
      items: [{ ...base.items[0], body: completeBody }],
    });
    expect(complete.html).toContain("<strong>Visible 😀</strong>");
    expect(complete.html).not.toContain("Read more");

    const clipped = await renderDigest({
      ...base,
      items: [{ ...base.items[0], body: completeBody + "Omitted" }],
    });
    expect(clipped.html).toContain("<strong>Visible 😀</strong>");
    expect(clipped.html).not.toContain("Omitted");
    expect(clipped.html).toContain("Read more</a>");
  });
  it("removes active markup and unsafe URLs without fetching user image URLs", async () => {
    const result = await renderDigest({
      ...base,
      items: [
        {
          ...base.items[0],
          body: '<script>alert(1)</script><style>evil</style><p onclick="bad()">Safe <b>text</b></p><img src="https://remote.invalid/a.png"><a href="javascript:alert(1)">bad</a><a href="https://user:password@example.edu">secret</a>',
        },
      ],
    });
    expect(result.html).not.toMatch(
      /alert|onclick|javascript:|password@|remote.invalid|<script|<style|<img/,
    );
    expect(result.text).toContain("Safe text");
    expect(result.text).not.toContain("evil");
  });
  it("renders inline and display LaTeX as real inline PNG copies, not raw source", async () => {
    const result = await renderDigest({
      ...base,
      items: [
        { ...base.items[0], body: "Inline $x^2$ and\n\n$$\\frac{1}{2}$$" },
      ],
    });
    expect(result.html).toContain('src="cid:');
    expect(result.html).not.toContain("language-math");
    expect(result.attachments).toHaveLength(2);
    expect(result.html).not.toContain("Read more");
    for (const image of result.attachments) {
      expect(image.content.subarray(0, 8)).toEqual(
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      );
      expect(image.contentType).toBe("image/png");
    }
    expect(result.text).toContain("x^2");
  });
  it("embeds authorized attachment images as PNG copies without fetching Markdown images", async () => {
    const original = await sharp({
      create: { width: 1600, height: 800, channels: 3, background: "green" },
    })
      .png()
      .toBuffer();
    const result = await renderDigest({
      ...base,
      items: [
        {
          ...base.items[0],
          images: [
            {
              filename: "work.png",
              url: "https://app.example.edu/api/v1/attachments/image/download",
              sizeBytes: original.length,
              read: async () => original,
            },
          ],
        },
      ],
    });
    expect(result.attachments).toHaveLength(1);
    expect(result.html).toContain('src="cid:');
    expect(result.html).toContain('alt="work.png"');
    const metadata = await sharp(result.attachments[0].content).metadata();
    expect(metadata.width).toBe(1200);
    expect(metadata.format).toBe("png");
  });
  it("applies rotated and mirrored EXIF orientation to private PNG copies", async () => {
    const pixels = Buffer.alloc(40 * 20 * 3);
    for (let y = 0; y < 20; y++)
      for (let x = 0; x < 40; x++) {
        const offset = (y * 40 + x) * 3;
        pixels.set(x < 20 ? [255, 0, 0] : [0, 0, 255], offset);
      }
    for (const [orientation, width, height, first, second] of [
      [6, 20, 40, [255, 0, 0], [0, 0, 255]],
      [2, 40, 20, [0, 0, 255], [255, 0, 0]],
    ] as const) {
      const original = await sharp(pixels, {
        raw: { width: 40, height: 20, channels: 3 },
      })
        .jpeg()
        .withMetadata({ orientation })
        .toBuffer();
      const result = await renderDigest({
        ...base,
        items: [
          {
            ...base.items[0],
            images: [
              {
                filename: "oriented.jpg",
                url: "https://app.example.edu/image/oriented",
                sizeBytes: original.length,
                read: async () => original,
              },
            ],
          },
        ],
      });
      expect(result.attachments).toHaveLength(1);
      const png = result.attachments[0].content;
      const metadata = await sharp(png).metadata();
      expect([metadata.width, metadata.height, metadata.format]).toEqual([
        width,
        height,
        "png",
      ]);
      expect(metadata.exif).toBeUndefined();
      const { data, info } = await sharp(png)
        .raw()
        .toBuffer({ resolveWithObject: true });
      const sample = (x: number, y: number) => [
        ...data.subarray(
          (y * info.width + x) * info.channels,
          (y * info.width + x) * info.channels + 3,
        ),
      ];
      const near = orientation === 6 ? sample(10, 5) : sample(5, 10);
      const far = orientation === 6 ? sample(10, 35) : sample(35, 10);
      expect(near[0]).toBeGreaterThan(first[0] - 30);
      expect(near[2]).toBeGreaterThan(first[2] - 30);
      expect(far[0]).toBeGreaterThan(second[0] - 30);
      expect(far[2]).toBeGreaterThan(second[2] - 30);
    }
  });
  it("bounds Unicode previews and keeps equations whole at the preview boundary", async () => {
    const result = await renderDigest({
      ...base,
      items: [
        { ...base.items[0], body: "😀".repeat(599) + "$abcdef$ trailing" },
      ],
    });
    expect(result.text).not.toContain("abcde");
    expect(result.html).not.toContain('src="cid:');
    expect(result.text).toContain("😀".repeat(599));
    expect(result.text).not.toContain("trailing");
    expect(result.html).toContain("Read more</a>");
  });
  it("shows Read more only for omitted Unicode and formatted body content", async () => {
    const complete = await renderDigest({
      ...base,
      items: [{ ...base.items[0], body: `**${"😀".repeat(600)}**` }],
    });
    expect(complete.html).toContain(`<strong>${"😀".repeat(600)}</strong>`);
    expect(complete.html).not.toContain("Read more");

    const truncated = await renderDigest({
      ...base,
      items: [{ ...base.items[0], body: `**${"😀".repeat(601)}**` }],
    });
    expect(truncated.html).toContain(`<strong>${"😀".repeat(600)}</strong>`);
    expect(truncated.html).not.toContain("😀".repeat(601));
    expect(truncated.html).toContain("Read more</a>");
  });
  it("links previews that omit childless formatting at the character boundary", async () => {
    for (const [body, omittedTag] of [
      [`${"x".repeat(600)}\n\n---`, "hr"],
      [`<p>${"x".repeat(600)}<br></p>`, "br"],
      [`<blockquote><p>${"x".repeat(600)}</p><hr></blockquote>`, "hr"],
      [`<p>${"x".repeat(600)}</p><p><br></p>`, "br"],
    ]) {
      const result = await renderDigest({
        ...base,
        items: [{ ...base.items[0], body }],
      });
      expect(result.html).toContain("x".repeat(600));
      expect(result.html).not.toContain(`<${omittedTag}`);
      expect(result.html).toContain("Read more</a>");
    }
  });
  it("signals source and AST fallback truncation", async () => {
    const sourceBound = await renderDigest({
      ...base,
      items: [{ ...base.items[0], body: "A" + " ".repeat(128 * 1024) }],
    });
    expect(sourceBound.html).toContain("Read more</a>");

    const astBound = await renderDigest({
      ...base,
      items: [{ ...base.items[0], body: "<blockquote>".repeat(70) + "Nested" }],
    });
    expect(astBound.html).toContain("Read more</a>");

    const fallback = await renderDigest({
      ...base,
      items: [{ ...base.items[0], body: "<blockquote>".repeat(11000) }],
    });
    expect(fallback.html).toContain("View full content");
    expect(fallback.html).toContain("Read more</a>");
  });
  it("limits entries while preserving complete counts and the remaining activity link", async () => {
    const result = await renderDigest({
      ...base,
      counts: { post: 70, answer: 0, followup: 0 },
      items: Array.from({ length: 70 }, (_, i) => ({
        ...base.items[0],
        title: `Post ${i}`,
      })),
    });
    expect(result.html.match(/<article/g)).toHaveLength(50);
    expect(result.text).toContain("70 posts");
    expect(result.html).toContain("View remaining activity");
    expect(result.html).not.toContain("Post 50");
  });
  it("links corrupt and oversized images and never reads more than five image candidates", async () => {
    let reads = 0;
    const result = await renderDigest({
      ...base,
      items: [
        {
          ...base.items[0],
          images: Array.from({ length: 8 }, (_, index) => ({
            filename: `image-${index}.png`,
            url: `https://app.example.edu/image/${index}`,
            sizeBytes: 10,
            read: async () => {
              reads++;
              return Buffer.from("not a PNG");
            },
          })),
        },
      ],
    });
    expect(reads).toBe(5);
    expect(result.attachments).toHaveLength(0);
    expect(result.html).toContain("View image: image-7.png");
    const oversized = await renderDigest({
      ...base,
      items: [
        {
          ...base.items[0],
          images: [
            {
              filename: "large.png",
              url: "https://app.example.edu/image/large",
              sizeBytes: 6 * 1024 * 1024,
              read: async () => {
                throw new Error("must not read");
              },
            },
          ],
        },
      ],
    });
    expect(oversized.html).toContain("View image: large.png");
  });
  it("uses a safe linked placeholder for unsupported or oversized equations", async () => {
    const result = await renderDigest({
      ...base,
      items: [
        {
          ...base.items[0],
          body: "$\\require{html}\\href{javascript:evil}{click}$",
        },
      ],
    });
    expect(result.attachments).toHaveLength(0);
    expect(result.html).toContain("View equation");
    expect(result.html).not.toContain("javascript:");
    expect(result.text).toContain("require");
  });
  it("keeps failed equation placeholders atomic within the final preview budget", async () => {
    const fits = await renderDigest({
      ...base,
      items: [{ ...base.items[0], body: "x".repeat(587) + "$\\a$" }],
    });
    expect(fits.html).toContain("View equation</a>");
    expect(fits.html).not.toContain("Read more");
    expect(fits.text).toContain("\\a");

    const omitted = await renderDigest({
      ...base,
      items: [{ ...base.items[0], body: "x".repeat(596) + "$\\a$" }],
    });
    expect(omitted.html).toContain("x".repeat(596));
    expect(omitted.html).not.toContain("View equation</a>");
    expect(omitted.html).toContain("Read more</a>");
    expect(omitted.text).not.toContain("\\a");

    const trailing = await renderDigest({
      ...base,
      items: [
        { ...base.items[0], body: "x".repeat(580) + "$\\a$" + "y".repeat(30) },
      ],
    });
    expect(trailing.html).toContain("View equation</a>");
    expect(trailing.html).toContain("y".repeat(7));
    expect(trailing.html).not.toContain("y".repeat(8));
    expect(trailing.html).toContain("Read more</a>");
    expect(trailing.text).toContain("x".repeat(580) + "\\a" + "y".repeat(7));
    expect(trailing.text).not.toContain("y".repeat(8));
  });
  it("bounds quota-limited equation placeholders near the preview edge", async () => {
    const result = await renderDigest({
      ...base,
      items: [
        { ...base.items[0], body: "$x$ ".repeat(20) },
        {
          ...base.items[0],
          title: "Quota entry",
          body: "x".repeat(596) + "$x$",
        },
      ],
    });
    const articles = result.html.match(/<article\b[^>]*>[\s\S]*?<\/article>/g)!;
    expect(articles[1]).toContain("x".repeat(596));
    expect(articles[1]).not.toContain("View equation</a>");
    expect(articles[1]).toContain("Read more</a>");
    expect(result.text).not.toContain("x".repeat(597));
  }, 15_000);
  it("keeps only retained equation CIDs after placeholder and entry trimming", async () => {
    const result = await renderDigest({
      ...base,
      items: [
        { ...base.items[0], body: "x".repeat(587) + "$\\a$ $x$" },
        { ...base.items[0], title: "Following entry", body: "$x$" },
      ],
    });
    const articles = result.html.match(/<article\b[^>]*>[\s\S]*?<\/article>/g)!;
    expect(articles[0]).toContain("View equation</a>");
    expect(articles[0]).not.toContain('src="cid:equation-');
    expect(articles[0]).toContain("Read more</a>");
    expect(articles[1]).toContain('src="cid:equation-');
    expect(result.attachments).toHaveLength(1);
    expect(result.html).toContain(`cid:${result.attachments[0].cid}`);
    expect(result.text).toContain("x".repeat(587) + "\\a");
    expect(result.text).not.toContain("\\a x");
    expect(result.text).toContain("Following entry\nx");

    const omitted = await renderDigest({
      ...base,
      items: [{ ...base.items[0], title: "T".repeat(250 * 1024), body: "$x$" }],
    });
    expect(omitted.html).not.toContain("<article");
    expect(omitted.attachments).toHaveLength(0);
  });
  it("keeps malformed and excessive markup bounded without preventing the rest of the digest", async () => {
    const result = await renderDigest({
      ...base,
      items: [
        {
          ...base.items[0],
          body:
            "<blockquote>".repeat(11000) +
            "text" +
            "</blockquote>".repeat(11000),
        },
        { ...base.items[0], title: "Next entry", body: "Still readable" },
      ],
    });
    expect(Buffer.byteLength(result.html)).toBeLessThanOrEqual(256 * 1024);
    expect(result.html).toContain("Next entry");
    expect(result.text).toContain("Still readable");
  });
  it("keeps the full inline equation rather than only its first line-break fragment", async () => {
    const result = await renderDigest({
      ...base,
      items: [{ ...base.items[0], body: "$a+b+c+d+e+f$" }],
    });
    expect(result.attachments).toHaveLength(1);
    expect(
      (await sharp(result.attachments[0].content).metadata()).width,
    ).toBeGreaterThan(180);
  });
  it("renders standard AMS font glyphs entirely from local package files", async () => {
    const result = await renderDigest({
      ...base,
      items: [{ ...base.items[0], body: "$\\mathbb{R}$" }],
    });
    expect(result.attachments).toHaveLength(1);
    expect(result.html).not.toContain("View equation");
  });
  it("limits rendered equations per email and links the rest", async () => {
    const result = await renderDigest({
      ...base,
      items: [{ ...base.items[0], body: "$x$ ".repeat(21) }],
    });
    expect(result.attachments).toHaveLength(20);
    expect(result.html).toContain("View equation");
    expect(
      result.attachments.reduce(
        (bytes, image) => bytes + image.content.length,
        0,
      ),
    ).toBeLessThanOrEqual(1024 * 1024);
  }, 15_000);
  it("finishes a stalled image read with an authenticated link instead of blocking delivery", async () => {
    const started = Date.now();
    const result = await renderDigest({
      ...base,
      items: [
        {
          ...base.items[0],
          images: [
            {
              filename: "slow.png",
              url: "https://app.example.edu/image/slow",
              sizeBytes: 100,
              read: async () => new Promise(() => {}),
            },
          ],
        },
      ],
    });
    expect(Date.now() - started).toBeLessThan(4000);
    expect(result.attachments).toHaveLength(0);
    expect(result.html).toContain("View image: slow.png");
  });
});
