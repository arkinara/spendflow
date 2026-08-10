import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEMO, authedGet, bootstrap, login, type Harness } from "./helpers.js";

/**
 * Dev-only endpoint (#66): `GET /api/admin/dev/recent-invites` reads the last
 * 5 lines of `backend/logs/invites.log` and returns them parsed, newest first.
 * The log path is overridable via `SPENDFLOW_INVITE_LOG` so each test points
 * the route at an isolated temp file.
 */

let h: Harness;
let dir: string;
const savedEnv = process.env.SPENDFLOW_INVITE_LOG;

beforeEach(async () => {
  h = await bootstrap();
  dir = mkdtempSync(join(tmpdir(), "spendflow-invites-"));
  process.env.SPENDFLOW_INVITE_LOG = join(dir, "invites.log");
});

afterEach(() => {
  h.cleanup();
  rmSync(dir, { recursive: true, force: true });
});

afterAll(() => {
  if (savedEnv === undefined) delete process.env.SPENDFLOW_INVITE_LOG;
  else process.env.SPENDFLOW_INVITE_LOG = savedEnv;
});

function logLine(email: string, token: string, ts = "2026-08-10T11:05:44.888Z") {
  return `[${ts}] email=${email} token=${token} url=http://localhost:3000/invite/${token}`;
}

function writeLog(lines: string[]) {
  writeFileSync(process.env.SPENDFLOW_INVITE_LOG!, lines.join("\n") + "\n");
}

describe("GET /api/admin/dev/recent-invites", () => {
  it("returns the last 5 invite-log lines parsed, newest first (Finance Admin)", async () => {
    writeLog([
      logLine("one@spendflow.example", "tok_1", "2026-08-10T11:05:40.000Z"),
      logLine("two@spendflow.example", "tok_2", "2026-08-10T11:05:41.000Z"),
      logLine("three@spendflow.example", "tok_3", "2026-08-10T11:05:42.000Z"),
      logLine("four@spendflow.example", "tok_4", "2026-08-10T11:05:43.000Z"),
      logLine("five@spendflow.example", "tok_5", "2026-08-10T11:05:44.000Z"),
      logLine("six@spendflow.example", "tok_6", "2026-08-10T11:05:45.000Z"),
    ]);

    const cookie = (await login(h.app, DEMO.finance.email)).cookie!;
    const res = await authedGet(h.app, "/api/admin/dev/recent-invites", cookie);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { entries: unknown[] };
    expect(body.entries).toHaveLength(5);
    // Newest first; the oldest line ("one") is cut off by the 5-line cap.
    expect(body.entries[0]).toEqual({
      email: "six@spendflow.example",
      inviteUrl: "http://localhost:3000/invite/tok_6",
      sentAt: "2026-08-10T11:05:45.000Z",
    });
    expect(body.entries[4]).toEqual({
      email: "two@spendflow.example",
      inviteUrl: "http://localhost:3000/invite/tok_2",
      sentAt: "2026-08-10T11:05:41.000Z",
    });
  });

  it("returns every line when the log has fewer than 5 entries", async () => {
    writeLog([
      logLine("only@spendflow.example", "tok_1"),
      logLine("two@spendflow.example", "tok_2"),
    ]);

    const cookie = (await login(h.app, DEMO.finance.email)).cookie!;
    const res = await authedGet(h.app, "/api/admin/dev/recent-invites", cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: { email: string }[] };
    expect(body.entries).toHaveLength(2);
    expect(body.entries[0].email).toBe("two@spendflow.example");
  });

  it("returns 404 when the invite log file doesn't exist", async () => {
    rmSync(process.env.SPENDFLOW_INVITE_LOG!, { force: true });
    const cookie = (await login(h.app, DEMO.finance.email)).cookie!;

    const res = await authedGet(h.app, "/api/admin/dev/recent-invites", cookie);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("not_found");
  });

  it("rejects a non-Finance session with 403 forbidden", async () => {
    writeLog([logLine("one@spendflow.example", "tok_1")]);
    const emp = await login(h.app, DEMO.employee.email);
    expect(emp.status).toBe(200);

    const res = await authedGet(h.app, "/api/admin/dev/recent-invites", emp.cookie);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("forbidden");
  });

  it("rejects an unauthenticated request with 401", async () => {
    writeLog([logLine("one@spendflow.example", "tok_1")]);
    const res = await authedGet(h.app, "/api/admin/dev/recent-invites", null);
    expect(res.status).toBe(401);
  });
});
