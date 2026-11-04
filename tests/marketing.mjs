import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyPost, captionFor, normalizeHashtags, safeSocialUrl, validatePost, localDateKey, dateTimeInput, localInputToIso, metricNumber, analyticsSamples, rankInsights } from "../lib/workspace/marketing-utils.ts";
import { parseSocialConnections, findSocialConnection, supportsDirectPublishing, verifySocialIdentity, sendTextPost } from "../lib/workspace/marketing-providers.ts";

const connection = { appSlug: null, platform: "facebook", accountId: "123", handle: "Company", accessToken: "test-secret", apiVersion: "v23.0" };
const xConnection = { appSlug: "novanook", platform: "x", accountId: "456", handle: "@app", accessToken: "test-x-secret" };
const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// A planned wall-clock time must keep its meaning across daylight saving changes.
test("planned times preserve timezones and reject nonexistent or invalid local dates", () => {
  assert.equal(localInputToIso("2026-01-15T09:00", "America/Chicago"), "2026-01-15T15:00:00.000Z");
  assert.equal(localInputToIso("2026-07-15T09:00", "America/Chicago"), "2026-07-15T14:00:00.000Z");
  assert.equal(localInputToIso("2026-03-08T02:30", "America/Chicago"), null);
  assert.equal(localInputToIso("2026-02-30T09:00", "America/Chicago"), null);
  assert.equal(localInputToIso("2026-07-15T09:00", "invalid/timezone"), null);
  assert.equal(dateTimeInput("2026-07-15T14:00:00.000Z", "America/Chicago"), "2026-07-15T09:00");
  assert.equal(localDateKey("2026-07-15T02:00:00Z", "America/Chicago"), "2026-07-14");
});

test("caption and links remain usable without treating account credentials as a link", () => {
  assert.equal(normalizeHashtags("#apps, apps  ##launch"), "#apps #launch");
  assert.equal(captionFor({ ...emptyPost(), caption: " Release ", mentions: " @team ", hashtags: "apps,launch" }), "Release\n\n@team\n\n#apps #launch");
  assert.equal(safeSocialUrl("https://www.instagram.com/p/abc/"), "https://www.instagram.com/p/abc/");
  for (const url of ["javascript:alert(1)", "http://example.com", "https://user:secret@example.com", "bad url"]) assert.equal(safeSocialUrl(url), null);
});

test("schedule validation does not silently accept a missing or past date", () => {
  const post = { ...emptyPost(), caption: "A release", contentType: "text" };
  const now = new Date("2026-11-04T12:00:00Z");
  assert.equal(validatePost("Release", "draft", post, now).length, 0);
  assert.ok(validatePost("Release", "scheduled", post, now).length);
  assert.ok(validatePost("Release", "scheduled", { ...post, scheduledAt: "2026-11-04T11:00:00Z" }, now).length);
  assert.equal(validatePost("Release", "scheduled", { ...post, scheduledAt: "2026-11-05T12:00:00Z" }, now).length, 0);
});

test("performance treats missing counts as unknown and includes partially published posts", () => {
  assert.equal(metricNumber(""), undefined);
  assert.equal(metricNumber("0"), 0);
  assert.equal(metricNumber("-1"), undefined);
  assert.equal(metricNumber("1.5"), undefined);
  const makePost = (id, metrics) => ({ id, module: "marketing", appSlug: null, title: id, status: "scheduled", version: 1, data: { ...emptyPost(), platforms: ["facebook", "instagram"], contentType: "text", hashtags: "#launch", publication: { facebook: { url: "https://www.facebook.com/1", publishedAt: "2026-11-04T15:00:00Z", metrics: { source: "manual", capturedAt: "2026-11-05T00:00:00Z", ...metrics } } } } });
  const samples = analyticsSamples([makePost("unknown", { likes: 99 }), makePost("zero", { likes: 0, comments: 0, shares: 0, saves: 0 }), makePost("complete", { likes: 10, comments: 2, shares: 3, saves: 1 })], "all");
  assert.equal(samples.length, 3);
  assert.equal(analyticsSamples(samples.map(s => s.post), "instagram").length, 0);
  const insights = rankInsights(samples, "America/Chicago");
  assert.deepEqual(insights.formats, [{ name: "text", count: 2, average: 8 }]);
  assert.equal(insights.hashtags[0].count, 2);
  assert.equal(insights.times[0].count, 2);
});

test("connections require exact app/network scope and valid server configuration", () => {
  assert.deepEqual(parseSocialConnections(undefined), []);
  const entries = parseSocialConnections(JSON.stringify([connection, xConnection]));
  assert.equal(findSocialConnection(entries, null, "facebook")?.accountId, "123");
  assert.equal(findSocialConnection(entries, "novanook", "facebook"), undefined);
  assert.equal(findSocialConnection(entries, null, "x"), undefined);
  assert.throws(() => parseSocialConnections(JSON.stringify([connection, connection])), /one publishing account/);
  assert.throws(() => parseSocialConnections(JSON.stringify([{ ...connection, platform: "instagram" }])));
  assert.throws(() => parseSocialConnections(JSON.stringify([{ ...connection, apiVersion: undefined }])));
  assert.throws(() => parseSocialConnections(JSON.stringify([{ ...connection, accessToken: "SECRET\nINJECTION" }])), error => !error.message.includes("SECRET"));
  const post = { ...emptyPost(), contentType: "text" };
  assert.equal(supportsDirectPublishing(post), true);
  assert.equal(supportsDirectPublishing({ ...post, media: [{ path: "private/file.jpg" }] }), false);
  assert.equal(supportsDirectPublishing({ ...post, thumbnail: { path: "private/cover.jpg" } }), false);
});

test("identity verification checks token subject rather than a readable arbitrary Page", async () => {
  let called;
  assert.equal(await verifySocialIdentity(connection, async (url, options) => { called = { url, options }; return jsonResponse({ id: "123" }); }), true);
  assert.equal(called.url, "https://graph.facebook.com/v23.0/me?fields=id,name");
  assert.equal(called.options.headers.Authorization, "Bearer test-secret");
  assert.equal(called.options.redirect, "error");
  assert.equal(await verifySocialIdentity(connection, async () => jsonResponse({ id: "999" })), false);
  assert.equal(await verifySocialIdentity(xConnection, async () => jsonResponse({ data: { id: "456" } })), true);
  assert.equal(await verifySocialIdentity(connection, async () => { throw new Error("network failed"); }), false);
});

test("a confirmed provider response stores the actual post ID after one outbound write", async () => {
  for (const [configured, response, expectedUrl, expectedBody, postUrl] of [
    [connection, { id: "123_789" }, "https://graph.facebook.com/v23.0/123/feed", { message: "Launch" }, "https://www.facebook.com/123_789"],
    [xConnection, { data: { id: "789" } }, "https://api.x.com/2/tweets", { text: "Launch" }, "https://x.com/i/web/status/789"],
  ]) {
    let count = 0;
    const result = await sendTextPost(configured, "Launch", async (url, options) => {
      count++;
      assert.equal(url, expectedUrl);
      assert.equal(options.method, "POST");
      assert.deepEqual(JSON.parse(options.body), expectedBody);
      assert.equal(options.redirect, "error");
      return jsonResponse(response);
    });
    assert.equal(count, 1);
    assert.equal(result.state, "published");
    assert.equal(result.url, postUrl);
  }
});

test("ambiguous responses never cause an automatic second provider write", async () => {
  const ambiguous = [
    async () => jsonResponse({ error: "upstream" }, 500),
    async () => jsonResponse({}, 408),
    async () => jsonResponse({ accepted: true }),
    async () => new Response("not JSON", { status: 200 }),
    async () => { throw new Error("timeout after possible delivery"); },
  ];
  for (const response of ambiguous) {
    let count = 0;
    const result = await sendTextPost(connection, "Launch", async () => { count++; return response(); });
    assert.equal(result.state, "uncertain");
    assert.equal(count, 1);
    assert.equal(JSON.stringify(result).includes(connection.accessToken), false);
  }
  for (const status of [400, 401, 403, 429]) {
    let count = 0;
    const result = await sendTextPost(connection, "Launch", async () => { count++; return jsonResponse({ error: "rejected" }, status); });
    assert.equal(result.state, "failed");
    assert.equal(count, 1);
  }
});
