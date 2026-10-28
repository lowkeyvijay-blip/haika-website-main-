import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve } from "node:path";

import {
  createLeadActions,
  type ActionResult,
  type LeadFilters,
} from "../actions/leadActions";
import { createLeadIntake } from "../intake/leadIntake";
import { createManualClock } from "../lib/clock";
import { FileLeadRepository } from "../store/fileLeadStore";
import { DEMO_NOW_ISO, resetDemoData, seedDemoData } from "../store/seed";
import type { LeadSource, LeadStatus } from "../types/lead";

const API_PORT = Number(process.env["HAIKA_API_PORT"] ?? 3001);
const API_HOST = process.env["HAIKA_API_HOST"] ?? "127.0.0.1";
const STORE_PATH = resolve(process.env["HAIKA_STORE_PATH"] ?? "data/demo-store.json");
const INITIAL_NOW = process.env["HAIKA_NOW"] ?? DEMO_NOW_ISO;
const BODY_LIMIT_BYTES = 1024 * 1024;

class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: "INVALID_INPUT" | "NOT_FOUND",
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

const clock = createManualClock(INITIAL_NOW);
const repository = new FileLeadRepository({ filePath: STORE_PATH });
const actions = createLeadActions({ repository, clock });
const intake = createLeadIntake({ repository, clock });

function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

function fail<T>(
  code: "INVALID_INPUT" | "NOT_FOUND" | "INTERNAL_ERROR",
  message: string,
): { ok: false; error: { code: string; message: string } } {
  return { ok: false, error: { code, message } };
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  response.end(body);
}

function actionStatus(code: string): number {
  if (code === "NOT_FOUND") {
    return 404;
  }

  if (code === "INVALID_TRANSITION") {
    return 409;
  }

  return 400;
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;

    if (size > BODY_LIMIT_BYTES) {
      throw new HttpError(413, "INVALID_INPUT", "Request body is too large.");
    }

    chunks.push(buffer);
  }

  if (size === 0) {
    return undefined;
  }

  const raw = Buffer.concat(chunks).toString("utf8");

  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, "INVALID_INPUT", "Request body must be valid JSON.");
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readString(
  record: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = record?.[key];
  return typeof value === "string" ? value : undefined;
}

function parseFilters(url: URL): LeadFilters {
  const filters: LeadFilters = {};
  const status = url.searchParams.get("status");
  const owner = url.searchParams.get("owner");
  const source = url.searchParams.get("source");
  const search = url.searchParams.get("search");
  const overdue = url.searchParams.get("overdue");

  if (status !== null && status.length > 0) {
    filters.status = status as LeadStatus;
  }

  if (owner !== null && owner.trim().length > 0) {
    filters.owner = owner;
  }

  if (source !== null && source.length > 0) {
    filters.source = source as LeadSource;
  }

  if (search !== null && search.trim().length > 0) {
    filters.search = search;
  }

  if (overdue !== null) {
    if (overdue === "true") {
      filters.overdue = true;
    } else if (overdue === "false") {
      filters.overdue = false;
    } else {
      throw new HttpError(400, "INVALID_INPUT", "Overdue filter must be true or false.");
    }
  }

  return filters;
}

function stateCounts(): Promise<{
  leads: number;
  tasks: number;
  outboxMessages: number;
  activityEntries: number;
  now: string;
}> {
  return Promise.all([
    repository.listLeads(),
    repository.listTasks(),
    repository.listOutboxMessages(),
    repository.listActivityLog(),
  ]).then(([leads, tasks, outboxMessages, activityLog]) => ({
    leads: leads.length,
    tasks: tasks.length,
    outboxMessages: outboxMessages.length,
    activityEntries: activityLog.length,
    now: clock.now().toISOString(),
  }));
}

async function restoreDemoData(): Promise<Awaited<ReturnType<typeof stateCounts>>> {
  clock.set(INITIAL_NOW);
  await resetDemoData(repository, { clock });
  return stateCounts();
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,PATCH,OPTIONS",
      "access-control-allow-headers": "content-type",
    });
    response.end();
    return;
  }

  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const method = request.method ?? "GET";

  if (segments[0] !== "api") {
    sendJson(response, 404, fail("NOT_FOUND", "Route not found."));
    return;
  }

  if (segments.length === 2 && segments[1] === "health" && method === "GET") {
    sendJson(
      response,
      200,
      ok({
        status: "ok",
        store: STORE_PATH,
        now: clock.now().toISOString(),
      }),
    );
    return;
  }

  if (segments.length === 2 && segments[1] === "enquiries" && method === "POST") {
    const payload = await readBody(request);
    const result = await intake.submitLead(payload, "website form");
    const status = result.ok
      ? result.data.outcome === "created"
        ? 201
        : 200
      : actionStatus(result.error.code);
    sendJson(response, status, result);
    return;
  }

  if (segments.length === 2 && segments[1] === "summary" && method === "GET") {
    const result = await actions.getDashboardSummary();
    sendJson(response, result.ok ? 200 : actionStatus(result.error.code), result);
    return;
  }

  if (segments.length === 2 && segments[1] === "leads" && method === "GET") {
    const result = await actions.listLeads(parseFilters(url));
    sendJson(response, result.ok ? 200 : actionStatus(result.error.code), result);
    return;
  }

  if (segments.length === 3 && segments[1] === "leads" && method === "GET") {
    const result = await actions.getLead(segments[2] ?? "");
    sendJson(response, result.ok ? 200 : actionStatus(result.error.code), result);
    return;
  }

  if (
    segments.length === 4 &&
    segments[1] === "leads" &&
    segments[3] === "status" &&
    (method === "PATCH" || method === "POST")
  ) {
    const body = asRecord(await readBody(request));
    const result = await actions.updateStatus(
      segments[2] ?? "",
      readString(body, "status") as LeadStatus,
      readString(body, "note"),
    );
    sendJson(response, result.ok ? 200 : actionStatus(result.error.code), result);
    return;
  }

  if (
    segments.length === 4 &&
    segments[1] === "leads" &&
    segments[3] === "reassign" &&
    method === "POST"
  ) {
    const body = asRecord(await readBody(request));
    const result = await actions.reassign(
      segments[2] ?? "",
      readString(body, "owner") as string,
    );
    sendJson(response, result.ok ? 200 : actionStatus(result.error.code), result);
    return;
  }

  if (
    segments.length === 4 &&
    segments[1] === "leads" &&
    segments[3] === "notes" &&
    method === "POST"
  ) {
    const body = asRecord(await readBody(request));
    const result = await actions.addNote(
      segments[2] ?? "",
      readString(body, "text") as string,
    );
    sendJson(response, result.ok ? 200 : actionStatus(result.error.code), result);
    return;
  }

  if (
    segments.length === 4 &&
    segments[1] === "tasks" &&
    segments[3] === "complete" &&
    method === "POST"
  ) {
    const result = await actions.completeTask(segments[2] ?? "");
    sendJson(response, result.ok ? 200 : actionStatus(result.error.code), result);
    return;
  }

  if (segments.length === 2 && segments[1] === "overdue-check" && method === "POST") {
    const body = asRecord(await readBody(request));
    const nowValue = readString(body, "now");
    let now: Date | undefined;

    if (nowValue !== undefined) {
      now = new Date(nowValue);

      if (Number.isNaN(now.getTime())) {
        sendJson(response, 400, fail("INVALID_INPUT", "Clock date is invalid."));
        return;
      }
    }

    const result = await actions.runOverdueCheck(now);
    sendJson(response, result.ok ? 200 : actionStatus(result.error.code), result);
    return;
  }

  if (segments.length === 2 && segments[1] === "seed" && method === "POST") {
    sendJson(response, 200, ok(await restoreDemoData()));
    return;
  }

  if (segments.length === 2 && segments[1] === "reset" && method === "POST") {
    sendJson(response, 200, ok(await restoreDemoData()));
    return;
  }

  if (segments.length === 2 && segments[1] === "clock" && method === "GET") {
    sendJson(
      response,
      200,
      ok({
        now: clock.now().toISOString(),
        initialNow: INITIAL_NOW,
      }),
    );
    return;
  }

  if (segments.length === 2 && segments[1] === "clock" && method === "POST") {
    const body = asRecord(await readBody(request));
    const nowValue = readString(body, "now");
    const advanceByMs = body?.["advanceByMs"];

    if (nowValue !== undefined && advanceByMs !== undefined) {
      sendJson(
        response,
        400,
        fail("INVALID_INPUT", "Set the clock or advance it, not both."),
      );
      return;
    }

    if (nowValue !== undefined) {
      const next = new Date(nowValue);

      if (Number.isNaN(next.getTime())) {
        sendJson(response, 400, fail("INVALID_INPUT", "Clock date is invalid."));
        return;
      }

      clock.set(next);
    } else if (typeof advanceByMs === "number" && Number.isFinite(advanceByMs)) {
      clock.advanceBy(advanceByMs);
    } else {
      sendJson(
        response,
        400,
        fail("INVALID_INPUT", "Provide a valid now value or advanceByMs."),
      );
      return;
    }

    sendJson(
      response,
      200,
      ok({
        now: clock.now().toISOString(),
        initialNow: INITIAL_NOW,
      }),
    );
    return;
  }

  sendJson(response, 404, fail("NOT_FOUND", "Route not found."));
}

async function main(): Promise<void> {
  const leads = await repository.listLeads();

  if (leads.length === 0) {
    await seedDemoData(repository, { clock });
  }

  const server = createServer((request, response) => {
    handleRequest(request, response).catch((error: unknown) => {
      const message =
        error instanceof HttpError
          ? error.message
          : error instanceof Error
            ? error.message
            : "Unexpected server error.";

      sendJson(
        response,
        error instanceof HttpError ? error.status : 500,
        fail(
          error instanceof HttpError ? error.code : "INTERNAL_ERROR",
          message,
        ),
      );
    });
  });

  server.listen(API_PORT, API_HOST, () => {
    console.log(`Haika API listening on http://${API_HOST}:${API_PORT}`);
    console.log(`Store: ${STORE_PATH}`);
    console.log(`Demo clock: ${clock.now().toISOString()}`);
  });

  const shutdown = (): void => {
    server.close(() => {
      process.exit(0);
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
