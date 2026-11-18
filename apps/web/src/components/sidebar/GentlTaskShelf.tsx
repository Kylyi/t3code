import { ChevronRightIcon, ListTodoIcon, RefreshCwIcon } from "lucide-react";
import { T, useGT } from "gt-react";
import { useEffect, useState } from "react";

import { resolvePrimaryEnvironmentHttpUrl } from "../../environments/primary";
import { readDesktopPrimaryBearerToken } from "../../environments/primary/desktopAuth";
import { SidebarGroup, SidebarMenuButton } from "../ui/sidebar";
import { SidebarHeaderIconButton } from "./SidebarThreadHeader";

interface TaskFeed {
  readonly mode: "sample" | "live";
  readonly tasks: ReadonlyArray<{
    readonly id: string;
    readonly uuid: string;
    readonly name: string;
  }>;
}

export function GentlTaskShelf() {
  const gt = useGT();
  const [open, setOpen] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [feed, setFeed] = useState<TaskFeed | null>(null);
  const [attempt, setAttempt] = useState<{ generation: number; failed: boolean } | null>(null);
  const refreshing = attempt?.generation !== refresh;
  const failed = !refreshing && attempt.failed;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Poll the task source only while the shelf is expanded.
  useEffect(() => {
    if (!open) return;
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
  }, [open, refresh]);

  return (
    <SidebarGroup>
      <div className="flex items-center gap-1">
        <SidebarMenuButton
          type="button"
          size="sm"
          aria-expanded={open}
          className="min-w-0 flex-1"
          onClick={() => setOpen(!open)}
        >
          <ChevronRightIcon className={open ? "size-3 rotate-90" : "size-3"} />
          <ListTodoIcon className="size-3.5" />
          <span>
            <T>Latest tasks</T>
          </span>
        </SidebarMenuButton>
        {open && (
          <SidebarHeaderIconButton
            label={gt("Refresh tasks")}
            disabled={refreshing}
            onClick={() => setRefresh((count) => count + 1)}
          >
            <RefreshCwIcon />
          </SidebarHeaderIconButton>
        )}
      </div>
      {open && (
        <div className="text-muted-foreground space-y-1 px-2 pb-1 text-xs" aria-live="polite">
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
            <ul className="space-y-1.5">
              {feed.tasks.map((task) => (
                <li key={task.id} className="flex min-w-0 items-baseline gap-2">
                  <span className="shrink-0 tabular-nums">#{task.uuid}</span>
                  <span className="text-sidebar-foreground line-clamp-2 break-words">
                    {task.name}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </SidebarGroup>
  );
}
