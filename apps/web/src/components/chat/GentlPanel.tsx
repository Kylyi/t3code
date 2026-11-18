import type { ScopedThreadRef } from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon, RefreshCwIcon } from "lucide-react";
import { useState } from "react";

import type { DraftId } from "../../composerDraftStore";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { GentlLoadState, GentlPicker, GentlStatus } from "./gentlControls";
import { GentlTaskDetail } from "./GentlTaskDetail";
import {
  gentlRequest,
  useGentlData,
  type GentlBoard,
  type GentlBoardMetadata,
  type GentlScope,
  type GentlTask,
  type GentlWorkspace,
} from "./gentlClient";

export function GentlPanel({
  threadRef,
  composerTarget,
  visible,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly composerTarget: ScopedThreadRef | DraftId;
  readonly visible: boolean;
}) {
  const gt = useGT();
  const workspaces = useGentlData<{ workspaces: GentlWorkspace[] }>(
    { action: "workspaces" },
    0,
    visible,
  );
  const [workspaceKey, setWorkspaceKey] = useState<string | null>(null);
  const options = workspaces.value?.workspaces ?? [];
  const key = (workspace: GentlWorkspace) => `${workspace.target}:${workspace.id}`;
  const workspace = options.find((item) => key(item) === workspaceKey);
  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label={gt("Gentl")}>
      {!workspaces.value ? (
        <GentlLoadState {...workspaces} />
      ) : (
        <div className="border-b border-border px-3 py-2">
          <GentlPicker
            label={gt("Workspace")}
            value={workspaceKey}
            disabled={options.length === 0}
            options={options.map((item) => ({
              id: key(item),
              name: options.some((other) => other !== item && other.name === item.name)
                ? `${item.name} (${item.target})`
                : item.name,
            }))}
            onChange={setWorkspaceKey}
          />
          {options.length === 0 && (
            <p className="mt-2 text-sm text-muted-foreground">
              <T>No workspaces available.</T>
            </p>
          )}
        </div>
      )}
      {workspace && (
        <GentlWorkspaceBoards key={key(workspace)} {...{ workspace, threadRef, composerTarget }} />
      )}
    </section>
  );
}

function GentlWorkspaceBoards({
  workspace,
  threadRef,
  composerTarget,
}: {
  workspace: GentlWorkspace;
  threadRef: ScopedThreadRef;
  composerTarget: ScopedThreadRef | DraftId;
}) {
  const gt = useGT();
  const scope = { target: workspace.target, instanceId: workspace.id };
  const boards = useGentlData<{ boards: GentlBoard[] }>({ action: "boards", ...scope });
  const [boardId, setBoardId] = useState<string | null>(null);
  if (!boards.value) return <GentlLoadState {...boards} />;
  const board = boards.value.boards.find((item) => item.id === boardId);
  return (
    <>
      <div className="border-b border-border px-3 py-2">
        <GentlPicker
          label={gt("Board")}
          value={boardId}
          options={boards.value.boards.map((item) => ({
            ...item,
            name: item.description ? `${item.name} (${item.description})` : item.name,
          }))}
          onChange={setBoardId}
          disabled={!boards.value.boards.length}
        />
        {!boards.value.boards.length && (
          <p className="mt-2 text-sm text-muted-foreground">
            <T>No boards available.</T>
          </p>
        )}
      </div>
      {board && (
        <GentlBoardTasks
          key={board.id}
          {...{ board, scope, workspace, threadRef, composerTarget }}
        />
      )}
    </>
  );
}

function GentlBoardTasks({
  board,
  scope,
  workspace,
  threadRef,
  composerTarget,
}: {
  board: GentlBoard;
  scope: GentlScope;
  workspace: GentlWorkspace;
  threadRef: ScopedThreadRef;
  composerTarget: ScopedThreadRef | DraftId;
}) {
  const gt = useGT();
  const [page, setPage] = useState(0);
  const [revision, setRevision] = useState(0);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [createFailed, setCreateFailed] = useState(false);
  const metadata = useGentlData<GentlBoardMetadata>({
    action: "board",
    ...scope,
    boardId: board.id,
  });
  const feed = useGentlData<{ tasks: GentlTask[] }>(
    { action: "tasks", ...scope, boardId: board.id, page },
    revision,
  );
  const refresh = () => setRevision((count) => count + 1);
  if (taskId) {
    return (
      <GentlTaskDetail
        key={taskId}
        taskScope={{ ...scope, taskId }}
        {...{ board, workspace, threadRef, composerTarget }}
        metadata={metadata.value}
        onBack={() => setTaskId(null)}
        onChange={refresh}
        onDelete={() => {
          setTaskId(null);
          refresh();
        }}
      />
    );
  }
  return (
    <>
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <h2 className="text-sm font-medium">
          <T>Tasks</T>
        </h2>
        <div className="flex gap-1">
          {metadata.value?.permissions.createTasks && (
            <Button size="xs" variant="outline" onClick={() => setCreating(!creating)}>
              <PlusIcon />
              <T>New task</T>
            </Button>
          )}
          <Button size="icon-xs" variant="ghost" aria-label={gt("Refresh tasks")} onClick={refresh}>
            <RefreshCwIcon />
          </Button>
        </div>
      </div>
      {creating && (
        <form
          className="flex flex-wrap gap-2 border-b border-border p-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!name.trim() || busy) return;
            setBusy(true);
            setCreateFailed(false);
            void gentlRequest<GentlTask>({ action: "create", ...scope, boardId: board.id, name })
              .then(
                (task) => {
                  setName("");
                  setCreating(false);
                  setTaskId(task.id);
                  refresh();
                },
                () => setCreateFailed(true),
              )
              .finally(() => setBusy(false));
          }}
        >
          <div className="min-w-32 flex-1">
            <Input
              aria-label={gt("Task title")}
              placeholder={gt("Task title")}
              value={name}
              maxLength={500}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <Button type="submit" size="sm" disabled={busy || !name.trim()}>
            <T>Create</T>
          </Button>
          {createFailed && (
            <p role="alert" className="w-full text-sm text-destructive">
              <T>Could not create task.</T>
            </p>
          )}
        </form>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        {!feed.value ? (
          <GentlLoadState {...feed} />
        ) : feed.value.tasks.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">
            <T>No tasks yet.</T>
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {feed.value.tasks.map((task) => (
              <li key={task.id}>
                <button
                  type="button"
                  onClick={() => setTaskId(task.id)}
                  className="flex w-full flex-col gap-1.5 px-3 py-2.5 text-left text-sm hover:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                >
                  <span className="flex items-baseline gap-2">
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      #{task.uuid}
                    </span>
                    <span className="min-w-0 break-words font-medium">{task.name}</span>
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5">
                    {task.status && <GentlStatus status={task.status} />}
                    {task.priority && <Badge variant="outline">{task.priority.name}</Badge>}
                    {task.type && <Badge variant="outline">{task.type.name}</Badge>}
                    {task.assignedTo?.map(
                      ({ user }) =>
                        user && (
                          <span key={user.id} className="text-xs text-muted-foreground">
                            {[user.firstName, user.lastName].filter(Boolean).join(" ")}
                          </span>
                        ),
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {(page > 0 || feed.value?.tasks.length === 50) && (
        <div className="flex justify-between border-t border-border px-3 py-2">
          <Button size="xs" variant="ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>
            <ChevronLeftIcon />
            <T>Previous</T>
          </Button>
          <Button
            size="xs"
            variant="ghost"
            disabled={feed.value?.tasks.length !== 50}
            onClick={() => setPage(page + 1)}
          >
            <T>Next</T>
            <ChevronRightIcon />
          </Button>
        </div>
      )}
    </>
  );
}
