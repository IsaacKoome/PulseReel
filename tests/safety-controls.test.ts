import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("safety records are server-controlled and cascade with users and content", () => {
  const migration = read("../supabase/migrations/202609200001_pulsereel_safety_controls.sql");
  assert.match(migration, /pulse_reel_user_blocks/);
  assert.match(migration, /pulse_reel_content_reports/);
  assert.match(migration, /pulse_reel_account_deletion_requests/);
  assert.match(migration, /on delete cascade/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /from anon, authenticated, service_role/);
  assert.match(migration, /to service_role/);
});

test("report, block, and deletion mutations require authenticated API routes", () => {
  for (const route of [
    "../app/api/projects/[slug]/report/route.ts",
    "../app/api/projects/[slug]/block/route.ts",
    "../app/api/projects/[slug]/comments/[commentId]/report/route.ts",
    "../app/api/account/deletion/route.ts",
  ]) {
    const source = read(route);
    assert.match(source, /getRequestUser\(request\)/);
    assert.match(source, /status: 401/);
  }
});

test("blocked creators are removed from authenticated feeds", () => {
  const feed = read("../app/api/projects/route.ts");
  assert.match(feed, /getBlockedUserIds/);
  assert.match(feed, /blockedCreatorIds/);
  assert.match(feed, /!Boolean\(project\.ownerId && blockedCreatorIds\?\.has\(project\.ownerId\)\)/);
});

test("mobile exposes report, block, comment report, and in-app deletion controls", () => {
  const api = read("../apps/mobile/src/lib/api.ts");
  const feed = read("../apps/mobile/src/app/index.tsx");
  const comments = read("../apps/mobile/src/app/comments/[slug].tsx");
  const profile = read("../apps/mobile/src/app/profile.tsx");
  assert.match(api, /reportMovie/);
  assert.match(api, /setCreatorBlocked/);
  assert.match(api, /reportMovieComment/);
  assert.match(api, /requestAccountDeletion/);
  assert.match(feed, /Report movie/);
  assert.match(feed, /Block creator/);
  assert.match(comments, /Report comment/);
  assert.match(profile, /Request account deletion/);
});

test("Google Play production builds disable external mobile checkout", () => {
  const billing = read("../apps/mobile/src/app/billing.tsx");
  const eas = read("../apps/mobile/eas.json");
  assert.match(billing, /EXPO_PUBLIC_GOOGLE_PLAY_RELEASE/);
  assert.match(billing, /Google Play purchases coming soon/);
  assert.match(eas, /EXPO_PUBLIC_GOOGLE_PLAY_RELEASE/);
  assert.match(eas, /app-bundle/);
});
