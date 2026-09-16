import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("social tables are server-controlled and cascade with movies and accounts", () => {
  const migration = read("../supabase/migrations/202609160001_pulsereel_social_controls.sql");
  assert.match(migration, /pulse_reel_movie_likes/);
  assert.match(migration, /pulse_reel_movie_comments/);
  assert.match(migration, /pulse_reel_creator_follows/);
  assert.match(migration, /pulse_reel_movie_shares/);
  assert.match(migration, /on delete cascade/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /from anon, authenticated, service_role/);
  assert.match(migration, /to service_role/);
});

test("social mutations require authenticated server routes", () => {
  for (const route of ["like", "follow", "comments"]) {
    const source = read(`../app/api/projects/[slug]/${route}/route.ts`);
    assert.match(source, /getRequestUser\(request\)/);
    assert.match(source, /status: 401/);
  }
});

test("feed exposes real following scope and viewer social state", () => {
  const route = read("../app/api/projects/route.ts");
  assert.match(route, /requestedScope === "mine" \|\| requestedScope === "following"/);
  assert.match(route, /getFollowedCreatorIds/);
  assert.match(route, /getProjectSocialSnapshots/);
  assert.match(route, /creatorId: project\.ownerId/);
  assert.match(route, /comments: social\?\.comments/);
});

test("mobile controls call persistent APIs and the native share sheet", () => {
  const feed = read("../apps/mobile/src/app/index.tsx");
  const api = read("../apps/mobile/src/lib/api.ts");
  const comments = read("../apps/mobile/src/app/comments/[slug].tsx");
  assert.match(feed, /Share\.share/);
  assert.match(feed, /setMovieLike/);
  assert.match(feed, /setCreatorFollow/);
  assert.match(feed, /scope.*following|"following"/);
  assert.match(api, /\/like/);
  assert.match(api, /\/follow/);
  assert.match(api, /\/comments/);
  assert.match(api, /\/share/);
  assert.match(comments, /postMovieComment/);
});
