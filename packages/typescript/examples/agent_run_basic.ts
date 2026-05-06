/**
 * End-to-end SDK flow: create a workspace, upload data, run an agent against
 * it, read what it wrote, and (optionally) clean up.
 *
 * Run from packages/typescript/:
 *   npm install
 *   export NEXTTOKEN_API_KEY=nt_...
 *   npx tsx examples/agent_run_basic.ts
 *
 * Optional toggles:
 *   NEXTTOKEN_EXAMPLE_CLEANUP=1     # delete the workspace at the end
 *   NEXTTOKEN_EXAMPLE_TEST_STREAM=1 # exercise Run.stream() (SSE events)
 *   NEXTTOKEN_EXAMPLE_TEST_CANCEL=1 # exercise Run.cancel()
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { NextToken } from "../src/index.js";

async function main(): Promise<number> {
  const apiKey = process.env["NEXTTOKEN_API_KEY"] ?? "";
  if (!apiKey) {
    console.error(
      "ERROR: NEXTTOKEN_API_KEY is not set. Get one from " +
        "https://nexttoken.co (Settings → API Keys).",
    );
    return 1;
  }

  const client = new NextToken({ apiKey });

  console.log("→ Creating workspace…");
  const ws = await client.workspaces.create("SDK example: revenue analysis");
  console.log(`  workspace_id = ${ws.id}`);

  console.log("→ Uploading sample data…");
  const sample = [
    "month,revenue,expenses",
    "2024-01,120000,80000",
    "2024-02,135000,82000",
    "2024-03,148000,85000",
    "2024-04,156000,87000",
    "2024-05,162000,90000",
    "2024-06,170000,91000",
    "",
  ].join("\n");
  await ws.writeText("inputs/data.csv", sample);
  console.log(`  uploaded inputs/data.csv (${sample.length} bytes)`);

  console.log("→ Creating agent session…");
  const agent = client.agents.create({ workspace: ws });

  console.log("→ Sending first prompt…");
  const run = await agent.send(
    "Read inputs/data.csv and write a one-paragraph summary to " +
      "outputs/summary.md. Highlight any month-over-month trends.",
  );
  console.log(`  run_id = ${run.runId}, conversation_id = ${run.conversationId}`);
  console.log("→ Waiting for terminal status (long-poll)…");
  const result = await run.wait();
  console.log(`  status = ${result.status}, duration_ms = ${result.durationMs}`);
  if (result.error) console.error(`  error: ${result.error}`);
  if (result.finalText) {
    console.log("\n— assistant said —");
    console.log(result.finalText);
    console.log("— end —\n");
  }

  console.log("→ Sending follow-up prompt…");
  const followUpRun = await agent.send(
    "Now compute the avg net margin and append it as a second paragraph " +
      "in outputs/summary.md.",
  );
  const result2 = await followUpRun.wait();
  console.log(`  follow-up status = ${result2.status}`);

  if (await ws.exists("outputs/summary.md")) {
    console.log("\n— outputs/summary.md —");
    console.log(await ws.readText("outputs/summary.md"));
    console.log("— end —\n");
  } else {
    console.error("WARN: agent did not produce outputs/summary.md");
  }

  if (await ws.exists("outputs/summary.md")) {
    const dest = join(mkdtempSync(join(tmpdir(), "nexttoken-")), "summary.md");
    const bytesWritten = await ws.download("outputs/summary.md", dest);
    console.log(`→ Downloaded summary to ${dest} (${bytesWritten} bytes)`);
  }

  if (process.env["NEXTTOKEN_EXAMPLE_TEST_STREAM"] === "1") {
    console.log("\n=== Stream (SSE) test ===");
    const streamWs = await client.workspaces.create(
      "SDK example: stream test",
    );
    const streamAgent = client.agents.create({ workspace: streamWs });
    const streamRun = await streamAgent.send(
      "Write a 4-line poem about CSV files to outputs/poem.md.",
    );
    console.log(`  run_id = ${streamRun.runId}, streaming events…`);

    let msgCount = 0;
    let terminal: Record<string, unknown> | null = null;
    for await (const ev of streamRun.stream()) {
      if (ev.type === "message") {
        msgCount += 1;
        const role = String(ev.data["role"] ?? "?");
        const content = String(ev.data["content"] ?? "")
          .slice(0, 80)
          .replace(/\n/g, " ");
        const seq = ev.data["sequence"];
        console.log(`  [seq=${seq} role=${role}] ${content}`);
      } else if (ev.type === "terminal") {
        terminal = ev.data;
        console.log(`  ↳ terminal: status=${ev.data["status"]}`);
      }
    }

    if (terminal === null) {
      console.error("  WARN: stream ended without a terminal event");
    } else if (terminal["status"] !== "completed") {
      console.error(
        `  WARN: stream terminal status was ${String(terminal["status"])}`,
      );
    } else {
      console.log(`  ✓ stream test ok (${msgCount} message events)`);
    }

    if (process.env["NEXTTOKEN_EXAMPLE_CLEANUP"] === "1") await streamWs.delete();
  }

  if (process.env["NEXTTOKEN_EXAMPLE_TEST_CANCEL"] === "1") {
    console.log("\n=== Cancel test ===");
    const cancelWs = await client.workspaces.create("SDK example: cancel test");
    const cancelAgent = client.agents.create({ workspace: cancelWs });
    const cancelRun = await cancelAgent.send(
      "Run a Python script that sleeps for 60 seconds and prints " +
        "'done', then write a one-paragraph reflection on what 60 " +
        "seconds of waiting felt like to outputs/reflection.md.",
      { timeoutSeconds: 180 },
    );
    console.log(`  run_id = ${cancelRun.runId}, sleeping 1s before cancel…`);
    await sleep(1000);

    console.log("  → cancelling…");
    await cancelRun.cancel();
    console.log("  → waiting for terminal…");
    const cancelResult = await cancelRun.wait({ timeoutMs: 30_000 });
    console.log(
      `  status = ${cancelResult.status}, duration_ms = ${cancelResult.durationMs}`,
    );
    if (cancelResult.status === "cancelled") {
      console.log("  ✓ cancel test ok");
    } else {
      console.error(`  WARN: expected 'cancelled', got ${cancelResult.status}`);
    }

    if (process.env["NEXTTOKEN_EXAMPLE_CLEANUP"] === "1") await cancelWs.delete();
  }

  if (process.env["NEXTTOKEN_EXAMPLE_CLEANUP"] === "1") {
    console.log("→ Deleting workspace…");
    await ws.delete();
    console.log("  done");
  } else {
    console.log(
      `→ Workspace ${ws.id} kept (set NEXTTOKEN_EXAMPLE_CLEANUP=1 to delete on success).`,
    );
  }

  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
