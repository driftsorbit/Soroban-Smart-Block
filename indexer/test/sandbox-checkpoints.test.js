import test from "node:test";
import assert from "node:assert/strict";

describe_tests();

function describe_tests() {
  function createMockApp() {
    let sandboxStore = {
      "sbx-123": {
        sandbox_id: "sbx-123",
        template_id: "soroban-hello-world",
        files: { "src/lib.rs": { content: "pub fn hello() {}" } },
        metadata: {
          checkpoints: [
            {
              id: "chk-init",
              name: "Initial state",
              createdAt: "2026-10-18T10:00:00.000Z",
              files: { "src/lib.rs": { content: "pub fn hello() {}" } },
            },
          ],
          scenarios: [
            {
              id: "scen-1",
              name: "Scenario A",
              contractId: "CAAA",
              fn: "hello",
              args: "[]",
              createdAt: "2026-10-18T10:00:00.000Z",
            },
          ],
        },
      },
    };

    return {
      async handleCreateCheckpoint(id, body) {
        const { name, description, files } = body || {};
        if (!name || typeof name !== "string" || !name.trim()) {
          return { status: 400, body: { error: "Checkpoint name is required" } };
        }
        const record = sandboxStore[id];
        if (!record) return { status: 404, body: { error: "Sandbox not found" } };

        const currentFiles = files || record.files;
        const metadata = record.metadata || {};
        const checkpoints = Array.isArray(metadata.checkpoints) ? metadata.checkpoints : [];

        const checkpoint = {
          id: `chk_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
          name: name.trim(),
          description: description ? String(description).trim() : "",
          createdAt: new Date().toISOString(),
          files: currentFiles,
        };

        record.metadata = { ...metadata, checkpoints: [...checkpoints, checkpoint] };
        return { status: 201, body: { ok: true, checkpoint } };
      },

      async handleReset(id, body) {
        const { checkpointId, confirm } = body || {};
        if (!checkpointId) return { status: 400, body: { error: "Missing checkpointId" } };
        if (confirm !== true) return { status: 400, body: { error: "Confirmation is required to reset environment" } };

        const record = sandboxStore[id];
        if (!record) return { status: 404, body: { error: "Sandbox not found" } };

        const metadata = record.metadata || {};
        const checkpoints = Array.isArray(metadata.checkpoints) ? metadata.checkpoints : [];
        const scenarios = Array.isArray(metadata.scenarios) ? metadata.scenarios : [];

        const target = checkpoints.find((c) => c.id === checkpointId || c.name === checkpointId);
        if (!target) return { status: 404, body: { error: "Checkpoint not found" } };

        // Non-destructive reset: files are restored from checkpoint, scenarios and checkpoints retained
        record.files = target.files;

        return {
          status: 200,
          body: {
            ok: true,
            restoredCheckpoint: target.name,
            retainedScenariosCount: scenarios.length,
            retainedCheckpointsCount: checkpoints.length,
            files: target.files,
          },
        };
      },

      async handleSaveScenario(id, body) {
        const { name, contractId, fn, args, description } = body || {};
        if (!name || typeof name !== "string" || !name.trim()) {
          return { status: 400, body: { error: "Scenario name is required" } };
        }
        const record = sandboxStore[id];
        if (!record) return { status: 404, body: { error: "Sandbox not found" } };

        const metadata = record.metadata || {};
        const scenarios = Array.isArray(metadata.scenarios) ? metadata.scenarios : [];

        const scenario = {
          id: `scen_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
          name: name.trim(),
          contractId: contractId ? String(contractId).trim() : "",
          fn: fn ? String(fn).trim() : "",
          args: typeof args === "string" ? args : JSON.stringify(args ?? []),
          description: description ? String(description).trim() : "",
          createdAt: new Date().toISOString(),
        };

        record.metadata = { ...metadata, scenarios: [...scenarios, scenario] };
        return { status: 201, body: { ok: true, scenario } };
      },

      getRecord(id) {
        return sandboxStore[id];
      },
    };
  }

  test("creates a named checkpoint and updates metadata", async () => {
    const app = createMockApp();
    const res = await app.handleCreateCheckpoint("sbx-123", {
      name: "Checkpoint after deploy",
      description: "Tokens minted",
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.checkpoint.name, "Checkpoint after deploy");
    assert.deepEqual(res.body.checkpoint.files, { "src/lib.rs": { content: "pub fn hello() {}" } });
  });

  test("rejects checkpoint creation with empty name", async () => {
    const app = createMockApp();
    const res = await app.handleCreateCheckpoint("sbx-123", { name: "   " });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /name is required/i);
  });

  test("returns 404 when sandbox does not exist for checkpoint", async () => {
    const app = createMockApp();
    const res = await app.handleCreateCheckpoint("sbx-missing", { name: "Valid name" });
    assert.equal(res.status, 404);
  });

  test("non-destructively resets environment to named checkpoint and retains scenarios", async () => {
    const app = createMockApp();
    // Simulate user modifying files
    app.getRecord("sbx-123").files = { "src/lib.rs": { content: "broken modified code" } };

    const res = await app.handleReset("sbx-123", {
      checkpointId: "chk-init",
      confirm: true,
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.restoredCheckpoint, "Initial state");
    assert.equal(res.body.retainedScenariosCount, 1);
    assert.equal(res.body.retainedCheckpointsCount, 1);
    // Files are restored back to checkpoint
    assert.equal(app.getRecord("sbx-123").files["src/lib.rs"].content, "pub fn hello() {}");
    // Saved scenarios are safely retained
    assert.equal(app.getRecord("sbx-123").metadata.scenarios.length, 1);
  });

  test("requires explicit confirmation for environment reset", async () => {
    const app = createMockApp();
    const res = await app.handleReset("sbx-123", {
      checkpointId: "chk-init",
      confirm: false,
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /Confirmation is required/i);
  });

  test("returns 404 if checkpoint does not exist on reset", async () => {
    const app = createMockApp();
    const res = await app.handleReset("sbx-123", {
      checkpointId: "nonexistent",
      confirm: true,
    });
    assert.equal(res.status, 404);
    assert.match(res.body.error, /Checkpoint not found/i);
  });

  test("saves a named scenario in sandbox metadata", async () => {
    const app = createMockApp();
    const res = await app.handleSaveScenario("sbx-123", {
      name: "Token transfer scenario",
      contractId: "CAAA",
      fn: "transfer",
      args: '["GBBB", 100]',
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.scenario.name, "Token transfer scenario");
    assert.equal(res.body.scenario.fn, "transfer");
    assert.equal(app.getRecord("sbx-123").metadata.scenarios.length, 2);
  });
}
