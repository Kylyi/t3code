import * as NodeModule from "node:module";
import * as NodeOS from "node:os";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Config from "effect/Config";
import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";
import * as Digest from "effect/crypto/Digest";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import type { z as Zod } from "zod";

// Zod is a file-backed dependency of the packaged WSL runtime.
const requireDependency = NodeModule.createRequire(import.meta.url);
const { z } = requireDependency("zod") as typeof import("zod");

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
  z.object({ action: z.literal("viewer"), ...scope }),
  z.object({
    action: z.literal("tasks"),
    ...scope,
    boardId: id,
    page: z.number().int().min(0).max(2000),
    search: z.string().trim().max(200).optional(),
    filters: z
      .object({
        sprintId: id.nullable().optional(),
        userIds: z.array(id).max(100).optional(),
        tagIds: z.array(id).max(100).optional(),
        statusIds: z.array(id).max(100).optional(),
        priorityId: id.optional(),
        typeId: id.optional(),
      })
      .optional(),
  }),
  z.object({ action: z.literal("detail"), ...task }),
  z.object({ action: z.literal("description"), ...task }),
  z.object({ action: z.literal("comments"), ...task, cursor }),
  z.object({
    action: z.literal("media"),
    ...task,
    attachmentId: id,
    commentId: id.optional(),
    fileId: id.regex(/^[a-zA-Z0-9_-]+$/).optional(),
  }),
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
type Target = Zod.infer<typeof targetConfig>;
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

const imageMime = /^image\/(?:png|jpeg|gif|webp|avif|bmp|x-icon)$/i;
const attachmentSchema = z.object({
  id: z.string(),
  kind: z.string(),
  label: z.string(),
  previewable: z.boolean().optional(),
  url: z.string().optional(),
});
const portableBody = z.object({ attachments: z.array(attachmentSchema) }).passthrough();
type PortableBody = Zod.infer<typeof portableBody>;

/** The portable preview names embedded images by hash. Recover the matching originals from
 * the stored Markdown without treating arbitrary HTML or other data URLs as images. */
const withOriginalImages = Effect.fn("GentlTasks.originalImages")(function* (
  body: PortableBody,
  raw: string | null | undefined,
) {
  if (!raw) return body;
  const ids = new Set(
    body.attachments.filter((file) => file.kind === "image" && !file.url).map((file) => file.id),
  );
  if (!ids.size) return body;
  const originalImages: Record<string, string> = {};
  const digest = yield* Digest.Digest;
  for (const [source] of raw.matchAll(
    /data:image\/(?:png|jpeg|gif|webp|avif|bmp|x-icon);base64,[a-z0-9+/=]+/gi,
  )) {
    const hash = yield* digest.digest(Digest.sha256, Buffer.from(`image\0${source}`));
    const key = Buffer.from(hash).toString("hex").slice(0, 24);
    if (ids.has(key)) originalImages[key] = source;
  }
  return { ...body, originalImages };
});

const readImageFile = Effect.fn("GentlTasks.readImageFile")(function* (
  target: Target,
  instanceId: string,
  fileId: string,
) {
  const url = yield* attempt(() =>
    targetUrl(target, `/api/fs/${encodeURIComponent(fileId)}?mustBeInDb=true`),
  );
  const response = yield* HttpClient.execute(
    HttpClientRequest.get(url, {
      headers: { ...authHeaders(target), "x-instance-id": instanceId },
    }),
  );
  const mime = response.headers["content-type"]?.split(";")[0] ?? "";
  const limit = 30 * 1024 * 1024;
  if (
    response.status !== 200 ||
    !imageMime.test(mime) ||
    Number(response.headers["content-length"]) > limit
  ) {
    return { failure: "missing" };
  }
  const bytes = yield* response.arrayBuffer;
  if (bytes.byteLength > limit) return { failure: "missing" };
  return { dataUrl: `data:${mime};base64,${Buffer.from(bytes).toString("base64")}` };
}, Effect.timeout("15 seconds"));

const enumeratorFields = { select: { id: true, name: true, style: true } };
const hasEmbeddedImages = (body: PortableBody) =>
  body.attachments.some((file) => file.kind === "image" && !file.url);

const PAGE_SIZE = 50;

export const runGentlCommand = Effect.fn("GentlTasks.run")(
  function* (command: Zod.infer<typeof GentlCommand>) {
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
      case "boards": {
        const [tracking, platform] = yield* Effect.all(
          [
            invoke("get_task_tracking_context", {}),
            invoke("get_platform_context", {}).pipe(Effect.orElseSucceed(() => null)),
          ],
          { concurrency: 2 },
        );
        const boards = z
          .object({
            boards: z.array(z.object({ id: z.string() }).passthrough()),
          })
          .safeParse(tracking);
        const structures = z
          .object({
            structures: z.array(z.object({ id: z.string(), name: z.string() })),
          })
          .safeParse(platform);
        if (!boards.success || !structures.success || !boards.data.boards.length) return tracking;

        const structureNames = new Map(
          structures.data.structures.map(({ id, name }) => [id, name]),
        );
        const namesByBoard = new Map<string, Set<string>>();
        const take = 500;
        const pageSchema = z.object({
          items: z.array(
            z.object({
              structureId: z.string(),
              related: z.object({ boardId: z.string().nullable().optional() }).optional(),
            }),
          ),
          hasMore: z.boolean(),
        });
        for (let skip = 0; ; skip += take) {
          const data = yield* invoke("list_structure_items", {
            contentType: "BOARD",
            take,
            skip,
          }).pipe(Effect.orElseSucceed(() => null));
          const page = pageSchema.safeParse(data);
          if (!page.success || !page.data.items.length) break;
          for (const item of page.data.items) {
            const name = structureNames.get(item.structureId);
            const boardId = item.related?.boardId;
            if (!name || !boardId) continue;
            const names = namesByBoard.get(boardId) ?? new Set<string>();
            names.add(name);
            namesByBoard.set(boardId, names);
          }
          if (!page.data.hasMore) break;
        }
        return {
          boards: boards.data.boards.map((board) => ({
            ...board,
            structureNames: [...(namesByBoard.get(board.id) ?? [])].sort(),
          })),
        };
      }
      case "board":
        return yield* invoke("get_board_task_metadata", { boardId: command.boardId });
      case "viewer": {
        const data = yield* invoke("get_platform_context", {});
        const viewer = z
          .object({ caller: z.object({ userId: z.string().nullable().optional() }) })
          .safeParse(data);
        return viewer.success ? { userId: viewer.data.caller.userId ?? null } : data;
      }
      case "tasks": {
        const { filters, search } = command;
        const serial = search?.match(/^#?(\d+)$/)?.[1];
        return yield* invoke("query_tasks", {
          where: {
            boardId: command.boardId,
            archivedAt: null,
            isTemplate: false,
            ...(search
              ? {
                  OR: [
                    { name: { contains: search, mode: "insensitive" } },
                    ...(serial ? [{ uuid: serial }] : []),
                  ],
                }
              : {}),
            ...(filters?.sprintId === null
              ? { sprints: { none: {} } }
              : filters?.sprintId
                ? { sprints: { some: { id: filters.sprintId } } }
                : {}),
            ...(filters?.userIds?.length
              ? { assignedTo: { some: { userId: { in: filters.userIds } } } }
              : {}),
            ...(filters?.tagIds?.length
              ? { AND: filters.tagIds.map((id) => ({ tags: { some: { id } } })) }
              : {}),
            ...(filters?.statusIds?.length ? { statusId: { in: filters.statusIds } } : {}),
            ...(filters?.priorityId ? { priorityId: filters.priorityId } : {}),
            ...(filters?.typeId ? { typeId: filters.typeId } : {}),
          },
          orderBy: [{ position: "asc" }, { id: "asc" }],
          take: PAGE_SIZE,
          skip: command.page * PAGE_SIZE,
          select: {
            id: true,
            name: true,
            uuid: true,
            dueDate: true,
            status: enumeratorFields,
            priority: enumeratorFields,
            type: enumeratorFields,
            assignedTo: {
              select: { user: { select: { id: true, firstName: true, lastName: true } } },
            },
          },
        });
      }
      case "detail": {
        const value = yield* invoke("get_task_preview", { taskId: command.taskId });
        const detail = z
          .object({ task: z.record(z.string(), z.unknown()), description: portableBody })
          .safeParse(value);
        if (!detail.success) return value;
        const metadata = yield* invoke("query_tasks", {
          where: { id: command.taskId },
          take: 1,
          select: {
            priority: enumeratorFields,
            type: enumeratorFields,
            ...(hasEmbeddedImages(detail.data.description) ? { description: true } : {}),
          },
        }).pipe(Effect.orElseSucceed(() => null));
        const row = z
          .object({
            tasks: z.array(
              z.object({
                description: z.string().nullable().optional(),
                priority: z.unknown(),
                type: z.unknown(),
              }),
            ),
          })
          .safeParse(metadata);
        const styles = row.success ? row.data.tasks[0] : undefined;
        return {
          task: {
            ...detail.data.task,
            ...(styles ? { priority: styles.priority, type: styles.type } : {}),
          },
          description: yield* withOriginalImages(detail.data.description, styles?.description),
        };
      }
      case "description":
        return yield* invoke("query_tasks", {
          where: { id: command.taskId },
          take: 1,
          select: { description: true },
        });
      case "comments": {
        const value = yield* invoke("list_task_preview_comments", {
          taskId: command.taskId,
          cursor: command.cursor,
        });
        const page = z
          .object({
            comments: z.array(z.object({ id: z.string(), body: portableBody }).passthrough()),
          })
          .passthrough()
          .safeParse(value);
        if (!page.success) return value;
        const embedded = page.data.comments.filter((comment) => hasEmbeddedImages(comment.body));
        if (!embedded.length) return value;
        const raw = yield* invoke("query_tasks", {
          where: { id: command.taskId },
          take: 1,
          select: {
            comments: {
              where: { id: { in: embedded.map((comment) => comment.id) } },
              select: { id: true, message: true },
            },
          },
        }).pipe(Effect.orElseSucceed(() => null));
        const rows = z
          .object({
            tasks: z.array(
              z.object({
                comments: z.array(z.object({ id: z.string(), message: z.string().nullable() })),
              }),
            ),
          })
          .safeParse(raw);
        const byId = new Map(
          rows.success ? rows.data.tasks[0]?.comments.map(({ id, message }) => [id, message]) : [],
        );
        return {
          ...page.data,
          comments: yield* Effect.forEach(page.data.comments, (comment) =>
            withOriginalImages(comment.body, byId.get(comment.id)).pipe(
              Effect.map((body) => ({ ...comment, body })),
            ),
          ),
        };
      }
      case "media":
        if (command.fileId) return yield* readImageFile(target, command.instanceId, command.fileId);
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
