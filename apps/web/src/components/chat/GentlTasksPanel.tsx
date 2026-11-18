import { RefreshCwIcon } from "lucide-react";
import { T, useGT } from "gt-react";
import { useEffect, useState } from "react";

import { resolvePrimaryEnvironmentHttpUrl } from "../../environments/primary";
import { readDesktopPrimaryBearerToken } from "../../environments/primary/desktopAuth";
import { Button } from "../ui/button";

interface TaskFeed {
  readonly mode: "sample" | "live";
  readonly tasks: ReadonlyArray<{
    readonly id: string;
    readonly uuid: string;
    readonly name: string;
  }>;
}

export function GentlTasksPanel({ visible }: { readonly visible: boolean }) {
  const gt = useGT();
  const [refresh, setRefresh] = useState(0);
  const [feed, setFeed] = useState<TaskFeed | null>(null);
  const [attempt, setAttempt] = useState<{ generation: number; failed: boolean } | null>(null);
  const refreshing = attempt?.generation !== refresh;
  const failed = !refreshing && attempt.failed;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Poll the task source only while the tasks surface is visible.
  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    let timer: number | undefined;
    async function load() {
      try {
        const token = await readDesktopPrimaryBearerToken();
        const response = await fetch(resolvePrimaryEnvironmentHttpUrl("/api/gentl/tasks"), {
          credentials: token ? "omit" : "include",
          headers: token ? { authorization: `Bearer ${token}` } : {},
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Task feed unavailable");
        const data: TaskFeed = await response.json();
        if (!controller.signal.aborted) {
          setFeed(data);
          setAttempt({ generation: refresh, failed: false });
        }
      } catch {
        if (!controller.signal.aborted) setAttempt({ generation: refresh, failed: true });
      } finally {
        if (!controller.signal.aborted) timer = window.setTimeout(load, 60_000);
      }
    }
    void load();
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [visible, refresh]);

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2">
        <h2 className="text-sm font-medium">
          <T>Latest tasks</T>
        </h2>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          aria-label={gt("Refresh tasks")}
          disabled={refreshing}
          onClick={() => setRefresh((count) => count + 1)}
        >
          <RefreshCwIcon />
        </Button>
      </header>
      <div
        className="text-muted-foreground flex-1 space-y-2 overflow-y-auto p-3 text-sm"
        aria-live="polite"
      >
        {failed && (
          <div role="status">
            <T>Could not load the latest tasks.</T>
          </div>
        )}
        {!feed && !failed && (
          <div role="status">
            <T>Loading tasks…</T>
          </div>
        )}
        {feed?.mode === "sample" && (
          <div>
            <T>Sample data</T>
          </div>
        )}
        {feed?.tasks.length === 0 && !failed && (
          <div>
            <T>No tasks yet.</T>
          </div>
        )}
        {feed && feed.tasks.length > 0 && (
          <ul className="divide-y">
            {feed.tasks.map((task) => (
              <li key={task.id} className="flex min-w-0 items-baseline gap-2 py-2">
                <span className="shrink-0 tabular-nums">#{task.uuid}</span>
                <span className="text-foreground min-w-0 break-words">{task.name}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
