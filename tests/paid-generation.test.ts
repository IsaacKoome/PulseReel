import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const generationAccess = readFileSync(
  new URL("../lib/generation-access.ts", import.meta.url),
  "utf8",
);
const projectRoute = readFileSync(
  new URL("../app/api/projects/route.ts", import.meta.url),
  "utf8",
);
const directProvider = readFileSync(
  new URL("../lib/replicate-direct.ts", import.meta.url),
  "utf8",
);

test("paid attempts bind to the project before direct provider submission", () => {
  assert.match(projectRoute, /const directProjectId = useDirectSeedance \? randomUUID\(\) : undefined/);
  assert.match(projectRoute, /reserveManagedGeneration\(user, provider, directProjectId\)/);
  assert.match(projectRoute, /projectId: directProjectId/);
  assert.match(generationAccess, /pulsereel_reserve_paid_attempt/);
  assert.match(generationAccess, /p_project_id: projectId/);
});

test("paid attempts reconcile once from confirmed provider outcomes", () => {
  assert.match(generationAccess, /pulsereel_finish_paid_attempt/);
  assert.match(generationAccess, /\.eq\("project_id", projectId\)/);
  assert.match(directProvider, /syncGenerationReservationForProject\(project\.id, "completed"\)/);
  assert.match(directProvider, /syncGenerationReservationForProject\(project\.id, "failed"\)/);
});

test("uncertain provider submissions do not trigger an automatic paid refund", () => {
  assert.match(directProvider, /class ProviderSubmissionUncertainError/);
  assert.match(projectRoute, /generationReservation\?\.kind === "paid" && error instanceof ProviderSubmissionUncertainError/);
  assert.match(projectRoute, /if \(!paidSubmissionNeedsReconciliation\)/);
});
