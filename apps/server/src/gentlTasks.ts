import * as NodeOS from "node:os";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Config from "effect/Config";
import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { z } from "zod";

const id = z.string().trim().min(1).max(200);
const cursor = z.string().max(500).optional();
const scope = { target: id, instanceId: id };
const task = { ...scope, taskId: id };
const patch = {
  name: z.string().trim().min(1).max(500).optional(),
  description: z.string().max(100_000).optional(),
  status: id.optional(),
  priority: id.nullable().optional(),
  type: id.nullable().optional(),
  assignees: z.array(id).max(100).optional(),
  tags: z.array(id).max(100).optional(),
};
export const GentlCommand = z.discriminatedUnion("action", [
  z.object({ action: z.literal("workspaces") }),
  z.object({ action: z.literal("boards"), ...scope }),
  z.object({ action: z.literal("board"), ...scope, boardId: id }),
  z.object({
    action: z.literal("tasks"),
    ...scope,
    boardId: id,
    page: z.number().int().min(0).max(2000),
  }),
  z.object({ action: z.literal("detail"), ...task }),
  z.object({ action: z.literal("description"), ...task }),
  z.object({ action: z.literal("comments"), ...task, cursor }),
  z.object({ action: z.literal("media"), ...task, attachmentId: id, commentId: id.optional() }),
  z.object({ action: z.literal("update"), ...task, changes: z.object(patch) }),
  z.object({
    action: z.literal("create"),
    ...scope,
    boardId: id,
    name: z.string().trim().min(1).max(500),
  }),
  z.object({
    action: z.literal("comment"),
    ...task,
    message: z.string().trim().min(1).max(30_000),
    parentId: id.optional(),
  }),
  z.object({ action: z.literal("delete"), ...task, confirmed: z.literal(true) }),
]);

const targetConfig = z.object({
  origin: z.url(),
  apiKey: z.string().optional(),
  instanceId: id.optional(),
});
type Target = z.infer<typeof targetConfig>;
const instances = z.array(
  z.object({ id, name: z.string(), domainName: z.string().nullable().optional() }),
);
const rpcResult = z.object({
  result: z.object({ structuredContent: z.unknown(), isError: z.boolean().optional() }),
});
const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
const attempt = <A>(run: () => A) =>
  Effect.try({ try: run, catch: () => "gentl_unavailable" as const });
const errorCode = z.object({ error: z.object({ code: z.string() }) });

const loadTargets = Effect.fn("GentlTasks.loadTargets")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const wslHome = yield* Config.String("T3CODE_GENTL_WSL_HOME").pipe(Config.withDefault(""));
  const platform = yield* HostProcess.Platform;
  const sharedHome =
    platform === "win32" && wslHome.startsWith("/")
      ? path.join("\\\\wsl.localhost\\Ubuntu", path.dirname(wslHome))
      : NodeOS.homedir();
  const dir = path.join(sharedHome, ".config", "gentl");
  const filename = yield* Config.String("T3_GENTL_TARGETS_FILE").pipe(
    Config.withDefault(path.join(dir, "mcp-targets.json")),
  );
  const configuredText = yield* fs.readFileString(filename);
  const localText = yield* fs
    .readFileString(path.join(path.dirname(filename), "mcp.json"))
    .pipe(Effect.orElseSucceed(() => "{}"));
  const configuredData = yield* decodeJson(configuredText);
  const localData = yield* decodeJson(localText);
  return yield* attempt(() => {
    const configured = z.record(id, targetConfig).parse(configuredData);
    const local = targetConfig.omit({ origin: true }).safeParse(localData);
    return {
      local: { origin: "http://localhost:3010", ...(local.success ? local.data : {}) },
      ...configured,
    };
  });
});

function targetUrl(target: Target, path: string) {
  const origin = new URL(target.origin);
  if (
    origin.username ||
    origin.password ||
    (origin.protocol !== "https:" &&
      !(
        origin.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)
      ))
  )
    throw new Error("Invalid Gentl target origin");
  return new URL(path, origin);
}

function authHeaders(target: Target) {
  return target.apiKey ? { "x-gentl-api-key": target.apiKey } : {};
}

const listInstances = Effect.fn("GentlTasks.listInstances")(function* (target: Target) {
  const url = yield* attempt(() => targetUrl(target, "/api/instances/accessible"));
  const response = yield* HttpClient.execute(
    HttpClientRequest.get(url, { headers: authHeaders(target) }),
  );
  if (response.status !== 200) return yield* Effect.fail("gentl_unavailable");
  const data = yield* response.json;
  return yield* attempt(() => instances.parse(data));
}, Effect.timeout("4 seconds"));

const call = Effect.fn("GentlTasks.call")(function* (
  target: Target,
  instanceId: string,
  name: string,
  args: object,
) {
  const url = yield* attempt(() => targetUrl(target, "/api/mcp/gentl"));
  const response = yield* HttpClient.execute(
    HttpClientRequest.post(url, {
      headers: {
        ...authHeaders(target),
        "x-instance-id": instanceId,
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-06-18",
      },
    }).pipe(
      HttpClientRequest.bodyJsonUnsafe({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    ),
  );
  if (response.status !== 200) return yield* Effect.fail("gentl_unavailable");
  const content = yield* response.text;
  const body = response.headers["content-type"]?.includes("text/event-stream")
    ? content
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5))
        .join("\n")
    : content;
  const data = yield* decodeJson(body);
  const { result } = yield* attempt(() => rpcResult.parse(data));
  const error = errorCode.safeParse(result.structuredContent);
  if (result.isError || error.success) {
    const code = error.success ? error.data.error.code : undefined;
    if (code === "FORBIDDEN") return { failure: "forbidden" as const };
    if (code === "NOT_FOUND") return { failure: "missing" as const };
    if (code === "CONFLICT" || code === "VALIDATION_ERROR") return { failure: "conflict" as const };
    return yield* Effect.fail("gentl_unavailable");
  }
  return result.structuredContent;
}, Effect.timeout("15 seconds"));

const PAGE_SIZE = 50;

export const runGentlCommand = Effect.fn("GentlTasks.run")(
  function* (command: z.infer<typeof GentlCommand>) {
    const targets: Record<string, Target> = yield* loadTargets();
    if (command.action === "workspaces") {
      const groups = yield* Effect.forEach(
        Object.entries(targets),
        ([target, config]) =>
          listInstances(config).pipe(
            Effect.map((entries) => entries.map((instance) => ({ ...instance, target }))),
            Effect.orElseSucceed(() => null),
          ),
        { concurrency: 4 },
      );
      if (groups.every((group) => group === null)) return yield* Effect.fail("gentl_unavailable");
      return { workspaces: groups.flatMap((group) => group ?? []) };
    }
    const target = Object.hasOwn(targets, command.target) ? targets[command.target] : undefined;
    if (!target) return yield* Effect.fail("gentl_unavailable");
    const invoke = (name: string, args: object) => call(target, command.instanceId, name, args);
    switch (command.action) {
      case "boards":
        return yield* invoke("get_task_tracking_context", {});
      case "board":
        return yield* invoke("get_board_task_metadata", { boardId: command.boardId });
      case "tasks":
        return yield* invoke("query_tasks", {
          where: { boardId: command.boardId, archivedAt: null, isTemplate: false },
          orderBy: [{ position: "asc" }, { id: "asc" }],
          take: PAGE_SIZE,
          skip: command.page * PAGE_SIZE,
          select: {
            id: true,
            name: true,
            uuid: true,
            dueDate: true,
            status: { select: { id: true, name: true, style: true } },
            priority: { select: { id: true, name: true } },
            type: { select: { id: true, name: true } },
            assignedTo: {
              select: { user: { select: { id: true, firstName: true, lastName: true } } },
            },
          },
        });
      case "detail":
        return yield* invoke("get_task_preview", { taskId: command.taskId });
      case "description":
        return yield* invoke("query_tasks", {
          where: { id: command.taskId },
          take: 1,
          select: { description: true },
        });
      case "comments":
        return yield* invoke("list_task_preview_comments", {
          taskId: command.taskId,
          cursor: command.cursor,
        });
      case "media":
        return yield* invoke("get_task_preview_media", {
          taskId: command.taskId,
          attachmentId: command.attachmentId,
          commentId: command.commentId,
        });
      case "update":
        return yield* invoke("update_task", { taskId: command.taskId, ...command.changes });
      case "create":
        return yield* invoke("create_task", { boardId: command.boardId, name: command.name });
      case "comment":
        if (command.parentId) {
          return yield* invoke("mutate_api_operation", {
            operationId: "commentCreate",
            body: {
              data: {
                message: command.message,
                instance: { connect: { id: command.instanceId } },
                task: { connect: { id: command.taskId } },
                parent: { connect: { id: command.parentId } },
              },
            },
          });
        }
        return yield* invoke("add_task_comment", {
          taskId: command.taskId,
          message: command.message,
        });
      case "delete":
        return yield* invoke("delete_api_operation", {
          operationId: "taskDeleteById",
          pathParams: { taskId: command.taskId },
          confirm: command.confirmed,
        });
    }
  },
  Effect.provideService(FetchHttpClient.RequestInit, { redirect: "error" }),
);
