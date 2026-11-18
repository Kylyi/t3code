import { describe, expect, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import { FetchHttpClient } from "effect/http";
import { loadGentlTasks } from "./gentlTasks.ts";

describe("Gentl task feed", () => {
  it.effect("provides explicitly labeled sample rows when no endpoint is configured", () =>
    Effect.gen(function* () {
      const feed = yield* loadGentlTasks().pipe(
        Effect.provide(FetchHttpClient.layer),
        Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromUnknown({})),
      );
      expect(feed.mode).toBe("sample");
      expect(feed.tasks.length).toBeGreaterThan(0);
    }),
  );

  it.effect.each(["application/json", "text/event-stream"])(
    "reads only the selected task fields from a %s MCP result",
    (contentType) =>
      Effect.gen(function* () {
        const config = ConfigProvider.fromUnknown({
          T3_GENTL_MCP_URL: "https://gentl.example.test/api/mcp/gentl",
          T3_GENTL_API_KEY: "fixture-key",
          T3_GENTL_INSTANCE_ID: "instance-1",
          T3_GENTL_BOARD_ID: "board-1",
        });
        const tasks = [{ id: "task-1", uuid: "42", name: "Test keyboard navigation" }];
        const payload = JSON.stringify({
          result: { structuredContent: { tasks: [{ ...tasks[0], description: "Private notes" }] } },
        });
        const mockFetch: typeof globalThis.fetch = async (_url, init) => {
          expect(JSON.parse(String(init?.body)).params.arguments).toMatchObject({
            where: { boardId: "board-1", archivedAt: null },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          });
          expect(init?.redirect).toBe("error");
          return new Response(
            contentType === "text/event-stream" ? `data: ${payload}\n\n` : payload,
            {
              headers: { "content-type": contentType },
            },
          );
        };
        const feed = loadGentlTasks().pipe(
          Effect.provide(FetchHttpClient.layer),
          Effect.provideService(FetchHttpClient.Fetch, mockFetch),
          Effect.provideService(ConfigProvider.ConfigProvider, config),
        );
        expect(yield* feed).toEqual({ mode: "live", tasks });
      }),
  );
});
