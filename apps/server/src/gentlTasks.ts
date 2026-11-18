import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

const Task = Schema.Struct({
  id: Schema.String,
  uuid: Schema.String,
  name: Schema.String,
});

const TaskResponse = Schema.Struct({
  result: Schema.Struct({
    structuredContent: Schema.Struct({ tasks: Schema.Array(Task) }),
  }),
});

const decodeTaskResponse = Schema.decodeUnknownEffect(Schema.fromJsonString(TaskResponse));

const sampleTasks: readonly (typeof Task.Type)[] = [
  { id: "sample-42", uuid: "42", name: "Fix keyboard navigation in the board" },
  { id: "sample-41", uuid: "41", name: "Add the task preview to the activity log" },
  { id: "sample-40", uuid: "40", name: "Review the sprint dashboard layout" },
];

export const loadGentlTasks = Effect.fn("GentlTasks.load")(
  function* () {
    const endpoint = yield* Config.String("T3_GENTL_MCP_URL").pipe(Config.withDefault(""));
    if (!endpoint) return { mode: "sample", tasks: sampleTasks };

    const token = yield* Config.Redacted("T3_GENTL_API_KEY");
    const instanceId = yield* Config.String("T3_GENTL_INSTANCE_ID");
    const boardId = yield* Config.String("T3_GENTL_BOARD_ID");
    if (!Redacted.value(token) || !instanceId || !boardId) {
      return yield* Effect.fail("Missing Gentl task feed configuration");
    }

    const request = HttpClientRequest.post(endpoint, {
      headers: {
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${Redacted.value(token)}`,
        "x-instance-id": instanceId,
      },
    }).pipe(
      HttpClientRequest.bodyJsonUnsafe({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "query_tasks",
          arguments: {
            where: { boardId, archivedAt: null },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            select: { id: true, uuid: true, name: true },
            take: 8,
          },
        },
      }),
    );
    const response = yield* HttpClient.execute(request);
    if (response.status !== 200) return yield* Effect.fail("Gentl task query failed");

    const body = yield* response.text;
    const eventData = response.headers["content-type"]?.includes("text/event-stream")
      ? body
          .split(/\r?\n/)
          .find((line) => line.startsWith("data:"))
          ?.slice(5)
      : body;
    const decoded = yield* decodeTaskResponse(eventData ?? "");
    return { mode: "live", tasks: decoded.result.structuredContent.tasks };
  },
  Effect.provideService(FetchHttpClient.RequestInit, { redirect: "error" }),
  Effect.timeout("8 seconds"),
);
