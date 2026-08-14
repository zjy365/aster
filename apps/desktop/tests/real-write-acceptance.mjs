import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// This script is intentionally opt-in. It performs one reversible scale write
// through the real Aster Core RPC and restores the original replica count.
// It refuses to run unless every target and the confirmation phrase are set.
if (process.env.ASTER_ALLOW_REAL_WRITE !== "1") {
  console.error("REAL_WRITE_SKIPPED: set ASTER_ALLOW_REAL_WRITE=1 to opt in; no cluster write was attempted.");
  process.exit(0);
}
const required = ["ASTER_REAL_WRITE_CONTEXT", "ASTER_REAL_WRITE_NAMESPACE", "ASTER_REAL_WRITE_NAME", "ASTER_REAL_WRITE_CONFIRM"];
for (const key of required) assert.ok(process.env[key], `missing ${key}`);
assert.equal(process.env.ASTER_REAL_WRITE_CONFIRM, "I_UNDERSTAND_ASTER_WILL_WRITE", "confirmation phrase does not match");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const core = path.join(root, process.arch === "arm64" ? "core/bin/arm64/aster-core" : "core/bin/x64/aster-core");
assert.ok(fs.existsSync(core), `missing core binary: ${core}`);
const token = `real-write-${Date.now()}`;
const child = spawn(core, [], { env: { ...process.env, ASTER_BOOTSTRAP_TOKEN: token }, stdio: ["ignore", "pipe", "pipe"] });
let stdout = "";
let stderr = "";
child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");
child.stdout.on("data", (chunk) => { stdout += chunk; });
child.stderr.on("data", (chunk) => { stderr += chunk; });

try {
  const ready = await waitForReady(child, () => stdout, stderr);
  const base = {
    contextId: process.env.ASTER_REAL_WRITE_CONTEXT,
    gvr: { group: "apps", version: "v1", resource: "deployments" },
    namespace: process.env.ASTER_REAL_WRITE_NAMESPACE,
    name: process.env.ASTER_REAL_WRITE_NAME,
  };
  const current = await request(ready.port, token, "/v1/resources/get", base);
  const originalReplicas = Number(current.resource?.desired ?? current.resource?.ready ?? 1);
  const targetReplicas = originalReplicas === 0 ? 1 : 0;
  const preview = await request(ready.port, token, "/v1/resources/mutate", { ...base, operation: "scale", replicas: targetReplicas, dryRun: true, resourceVersion: current.resource.resourceVersion });
  assert.equal(preview.dryRun, true);
  assert.equal(preview.changed, originalReplicas !== targetReplicas);
  const applied = await request(ready.port, token, "/v1/resources/mutate", { ...base, operation: "scale", replicas: targetReplicas, dryRun: false, resourceVersion: current.resource.resourceVersion });
  assert.equal(applied.dryRun, false);
  const observedApplied = await request(ready.port, token, "/v1/resources/get", base);
  assert.equal(observedApplied.resource.desired, targetReplicas, "applied replica count was not observable through a fresh GET");
  try {
    const restored = await request(ready.port, token, "/v1/resources/mutate", { ...base, operation: "scale", replicas: originalReplicas, dryRun: false, resourceVersion: applied.resourceVersion });
    assert.equal(restored.dryRun, false);
    const observedRestored = await request(ready.port, token, "/v1/resources/get", base);
    assert.equal(observedRestored.resource.desired, originalReplicas, "restored replica count was not observable through a fresh GET");
    const receipt = {
      realWrite: true,
      operation: "scale",
      targetFingerprint: createHash("sha256").update(`${base.contextId}\0${base.namespace}\0${base.name}`).digest("hex").slice(0, 16),
      dryRun: preview.dryRun,
      appliedObserved: true,
      restoredObserved: true,
      completedAt: new Date().toISOString(),
    };
    const output = path.join(root, "output", "acceptance");
    fs.mkdirSync(output, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(output, "real-write.json"), `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
    console.log(JSON.stringify(receipt));
  } catch (error) {
    console.error("REAL_WRITE_RESTORE_FAILED", error);
    throw error;
  }
} finally {
  child.kill("SIGTERM");
  if (child.exitCode === null) {
    await Promise.race([new Promise((resolve) => child.once("exit", resolve)), new Promise((resolve) => setTimeout(resolve, 2_000))]);
  }
}

async function waitForReady(child, readStdout, readStderr) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const line = readStdout().split("\n").find(Boolean);
    if (line) return JSON.parse(line);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`core did not become ready: ${readStderr()}`);
}

async function request(port, token, pathname, body) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const value = await response.json();
  if (!response.ok) throw new Error(`${pathname} ${response.status}: ${JSON.stringify(value)}`);
  return value;
}
