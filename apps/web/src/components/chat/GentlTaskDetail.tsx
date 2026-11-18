import type { ScopedThreadRef } from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import { ArrowLeftIcon, BotIcon, PencilIcon, ReplyIcon, SendIcon, Trash2Icon } from "lucide-react";
import { createContext, useContext, useRef, useState, type ReactNode } from "react";

import { useComposerDraftStore, type DraftId } from "../../composerDraftStore";
import { dispatchSnapShotComposerFocus } from "../../lib/desktopSnapShot";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import {
  gentlRequest,
  useGentlData,
  type GentlBoard,
  type GentlBoardMetadata,
  type GentlBody,
  type GentlComment,
  type GentlComments,
  type GentlDetail,
  type GentlTaskScope,
  type GentlWorkspace,
} from "./gentlClient";
import { GentlLoadState, GentlPicker, GentlBadge, GentlChoices } from "./gentlControls";

interface DetailProps {
  taskScope: GentlTaskScope;
  board: GentlBoard;
  workspace: GentlWorkspace;
  threadRef: ScopedThreadRef;
  composerTarget: ScopedThreadRef | DraftId;
  metadata: GentlBoardMetadata | undefined;
  onBack: () => void;
  onChange: () => void;
  onDelete: () => void;
}

export function GentlTaskDetail(props: DetailProps) {
  const [revision, setRevision] = useState(0);
  const detail = useGentlData<GentlDetail>({ action: "detail", ...props.taskScope }, revision);
  const refresh = () => {
    setRevision((count) => count + 1);
    props.onChange();
  };
  if (!detail.value) {
    return (
      <>
        <div className="p-2">
          <BackButton onClick={props.onBack} />
        </div>
        <GentlLoadState {...detail} />
      </>
    );
  }
  return <GentlTaskContent {...props} detail={detail.value} refresh={refresh} />;
}

function BackButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <Button size="xs" variant="ghost" onClick={onClick} disabled={disabled ?? false}>
      <ArrowLeftIcon />
      <T>Back to tasks</T>
    </Button>
  );
}

function GentlTaskContent({
  detail,
  taskScope,
  board,
  workspace,
  threadRef,
  composerTarget,
  metadata,
  onBack,
  onDelete,
  refresh,
}: DetailProps & {
  detail: GentlDetail;
  refresh: () => void;
}) {
  const gt = useGT();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteFailed, setDeleteFailed] = useState(false);
  const task = detail.task;
  const startImplementation = () => {
    const store = useComposerDraftStore.getState();
    const existing = store.getComposerDraft(composerTarget)?.prompt ?? "";
    const instruction = [
      // oxlint-disable-next-line t3code/no-em-dash-copy -- Preserve the approved composer template.
      `Implement Gentl task #${task.uuid} — ${task.name}`,
      "",
      "Read the task description and comments in Gentl before making changes.",
      "",
      `Gentl MCP · ${workspace.name} / ${board.name}`,
      `Target: \`${workspace.target}\` · Instance: \`${workspace.id}\``,
      `Task ID: \`${task.id}\``,
    ].join("\n");
    if (!existing.includes(instruction)) {
      store.setPrompt(composerTarget, existing ? `${existing}\n\n${instruction}` : instruction);
    }
    dispatchSnapShotComposerFocus();
  };
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <header className="space-y-2 border-b border-border p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <BackButton onClick={onBack} disabled={deleting} />
          <div className="flex flex-wrap items-center gap-1">
            {metadata?.permissions.updateTasks && !editing && (
              <Button size="xs" variant="outline" onClick={() => setEditing(true)}>
                <PencilIcon />
                <T>Edit</T>
              </Button>
            )}
            {metadata?.permissions.deleteTasks && !editing && (
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={gt("Delete task")}
                onClick={() => {
                  setDeleteFailed(false);
                  setConfirmDelete(true);
                }}
              >
                <Trash2Icon />
              </Button>
            )}
          </div>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="min-w-0 break-words text-lg font-semibold">{task.name}</h2>
          <span className="shrink-0 text-sm tabular-nums text-muted-foreground">#{task.uuid}</span>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-2">
          {!editing && (
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {task.status && <GentlBadge option={task.status} />}
                {task.priority && <GentlBadge option={task.priority} />}
                {task.type && <GentlBadge option={task.type} />}
                {task.dueDate && (
                  <Badge variant="outline">{new Date(task.dueDate).toLocaleDateString()}</Badge>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {task.assignedTo?.map(
                  ({ user }) =>
                    user && (
                      <Badge key={user.id} variant="secondary">
                        {[user.firstName, user.lastName].filter(Boolean).join(" ")}
                      </Badge>
                    ),
                )}
                {task.tags?.map((tag) => (
                  <Badge key={tag.id} variant="outline">
                    {tag.name}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          <div className="ml-auto">
            <Button size="sm" onClick={startImplementation}>
              <BotIcon />
              <T>Start implementation</T>
            </Button>
          </div>
        </div>
      </header>
      <div className="space-y-5 p-3">
        {editing && metadata ? (
          <GentlEditTask
            detail={detail}
            taskScope={taskScope}
            metadata={metadata}
            onCancel={() => setEditing(false)}
            onSaved={() => {
              setEditing(false);
              refresh();
            }}
          />
        ) : (
          <section className="space-y-2" aria-label={gt("Description")}>
            <h3 className="text-sm font-semibold">
              <T>Description</T>
            </h3>
            <div className="rounded-lg border border-border p-3">
              {detail.description.markdown || detail.description.attachments.length > 0 ? (
                <TaskBody threadRef={threadRef} scope={taskScope} body={detail.description} />
              ) : (
                <p className="text-sm text-muted-foreground">
                  <T>No description.</T>
                </p>
              )}
            </div>
          </section>
        )}
        <GentlTaskComments
          taskScope={taskScope}
          threadRef={threadRef}
          canComment={board.canEditTasks}
        />
      </div>
      <AlertDialog
        open={confirmDelete}
        onOpenChange={(open) => {
          if (!deleting) setConfirmDelete(open);
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <T>Delete task?</T>
            </AlertDialogTitle>
            <AlertDialogDescription>
              <T>This removes the task from Gentl.</T>
            </AlertDialogDescription>
            {deleteFailed && (
              <p role="alert" className="text-sm text-destructive">
                <T>Could not delete task.</T>
              </p>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" disabled={deleting} />}>
              <T>Cancel</T>
            </AlertDialogClose>
            <Button
              variant="destructive"
              disabled={deleting}
              onClick={() => {
                setDeleting(true);
                setDeleteFailed(false);
                void gentlRequest({ action: "delete", ...taskScope, confirmed: true })
                  .then(
                    () => {
                      setConfirmDelete(false);
                      onDelete();
                    },
                    () => setDeleteFailed(true),
                  )
                  .finally(() => setDeleting(false));
              }}
            >
              <T>Delete task</T>
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </div>
  );
}

function GentlEditTask({
  detail,
  taskScope,
  metadata,
  onCancel,
  onSaved,
}: {
  detail: GentlDetail;
  taskScope: GentlTaskScope;
  metadata: GentlBoardMetadata;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const gt = useGT();
  const original = useGentlData<{ tasks: { description?: string | null }[] }>({
    action: "description",
    ...taskScope,
  });
  const task = detail.task;
  const noValue = { id: "", name: gt("None") };
  const [name, setName] = useState(task.name);
  const [status, setStatus] = useState(task.status?.id);
  const [priority, setPriority] = useState(task.priority?.id ?? "");
  const [type, setType] = useState(task.type?.id ?? "");
  const [description, setDescription] = useState<string>();
  const [assignees, setAssignees] = useState(
    () => task.assignedTo?.flatMap(({ user }) => (user ? [user.id] : [])) ?? [],
  );
  const [tags, setTags] = useState(() => task.tags?.map(({ id }) => id) ?? []);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const initialDescription = original.value?.tasks[0]?.description ?? "";
  return (
    <form
      className="space-y-3 rounded-lg border border-border p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (saving || !name.trim()) return;
        const changes = {
          ...(name !== task.name ? { name } : {}),
          ...(status && status !== task.status?.id ? { status } : {}),
          ...(priority !== (task.priority?.id ?? "") ? { priority: priority || null } : {}),
          ...(type !== (task.type?.id ?? "") ? { type: type || null } : {}),
          ...(description !== undefined && description !== initialDescription
            ? { description }
            : {}),
          ...(assignees.join() !==
          (task.assignedTo?.flatMap(({ user }) => (user ? [user.id] : [])) ?? []).join()
            ? { assignees }
            : {}),
          ...(tags.join() !== (task.tags?.map(({ id }) => id) ?? []).join() ? { tags } : {}),
        };
        if (!Object.keys(changes).length) {
          onCancel();
          return;
        }
        setSaving(true);
        setFailed(false);
        void gentlRequest({ action: "update", ...taskScope, changes }).then(onSaved, () => {
          setFailed(true);
          setSaving(false);
        });
      }}
    >
      <label className="block space-y-1 text-sm">
        <span>
          <T>Task title</T>
        </span>
        <Input
          value={name}
          maxLength={500}
          disabled={saving}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label={<T>Status</T>}>
          <GentlPicker
            label={gt("Status")}
            value={status ?? null}
            options={metadata.statuses}
            disabled={saving}
            onChange={setStatus}
          />
        </Field>
        <Field label={<T>Priority</T>}>
          <GentlPicker
            label={gt("Priority")}
            value={priority}
            options={[noValue, ...metadata.priorities]}
            disabled={saving}
            onChange={setPriority}
          />
        </Field>
        <Field label={<T>Type</T>}>
          <GentlPicker
            label={gt("Type")}
            value={type}
            options={[noValue, ...metadata.types]}
            disabled={saving}
            onChange={setType}
          />
        </Field>
      </div>
      <GentlChoices
        label={gt("Assignees")}
        options={metadata.users}
        selected={assignees}
        onChange={setAssignees}
        disabled={saving}
      />
      <GentlChoices
        label={gt("Tags")}
        options={metadata.tags}
        selected={tags}
        onChange={setTags}
        disabled={saving}
      />
      {original.value?.tasks[0] ? (
        <label className="block space-y-1 text-sm">
          <span>
            <T>Description</T>
          </span>
          <Textarea
            rows={8}
            value={description ?? initialDescription}
            disabled={saving}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
      ) : (
        <GentlLoadState
          failed={original.failed || original.value !== undefined}
          retry={original.retry}
        />
      )}
      {failed && (
        <p role="alert" className="text-sm text-destructive">
          <T>Could not save task.</T>
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="outline" disabled={saving} onClick={onCancel}>
          <T>Cancel</T>
        </Button>
        <Button size="sm" type="submit" disabled={saving || !name.trim()}>
          <T>Save</T>
        </Button>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-1 text-sm">
      <div>{label}</div>
      {children}
    </div>
  );
}

const GENTL_MARKDOWN_PLUGINS = [remarkGfm];
const originalImage = /^data:image\/(?:png|jpeg|gif|webp|avif|bmp|x-icon);base64,/i;

const TaskMarkdownContext = createContext<{
  body: GentlBody;
  scope: GentlTaskScope;
  commentId: string | undefined;
} | null>(null);

const GENTL_MARKDOWN_COMPONENTS: Components = {
  a: function TaskLink({ href, children }) {
    const context = useContext(TaskMarkdownContext);
    const id = href?.match(/^#gentl-attachment-([a-f0-9]{24})$/)?.[1];
    const attachment = id ? context?.body.attachments.find((item) => item.id === id) : undefined;
    if (attachment?.kind === "image" && context) {
      return (
        <TaskImage
          attachment={attachment}
          source={context.body.originalImages?.[attachment.id]}
          scope={context.scope}
          commentId={context.commentId}
        />
      );
    }
    const destination = attachment?.url ?? href;
    return destination && /^https?:\/\//i.test(destination) ? (
      <a className="text-primary underline" href={destination} target="_blank" rel="noreferrer">
        {children}
      </a>
    ) : (
      <span>{children}</span>
    );
  },
};

function TaskBody({
  body,
  scope,
  commentId,
}: {
  body: GentlBody;
  threadRef: ScopedThreadRef;
  scope: GentlTaskScope;
  commentId?: string;
}) {
  return (
    <div className="chat-markdown min-w-0 space-y-2 wrap-anywhere text-sm">
      <TaskMarkdownContext.Provider value={{ body, scope, commentId }}>
        <ReactMarkdown
          remarkPlugins={GENTL_MARKDOWN_PLUGINS}
          components={GENTL_MARKDOWN_COMPONENTS}
        >
          {body.markdown}
        </ReactMarkdown>
      </TaskMarkdownContext.Provider>
      {body.truncated && (
        <p className="text-xs text-muted-foreground">
          <T>Preview truncated.</T>
        </p>
      )}
    </div>
  );
}

function TaskImage({
  attachment,
  source,
  scope,
  commentId,
}: {
  attachment: GentlBody["attachments"][number];
  source: string | undefined;
  scope: GentlTaskScope;
  commentId: string | undefined;
}) {
  const fileId = attachment.url?.match(/^\/api\/fs\/([a-zA-Z0-9_-]+)\?mustBeInDb=true$/)?.[1];
  const direct =
    source && originalImage.test(source)
      ? source
      : attachment.url?.startsWith("https://")
        ? attachment.url
        : undefined;
  const media = useGentlData<{ dataUrl: string }>(
    !direct && (fileId || attachment.previewable)
      ? { action: "media", ...scope, attachmentId: attachment.id, commentId, fileId }
      : null,
  );
  const src =
    direct ??
    (media.value?.dataUrl && originalImage.test(media.value.dataUrl)
      ? media.value.dataUrl
      : undefined);
  return src ? (
    <img
      className="my-2 block h-auto max-w-full rounded-md"
      alt={attachment.label}
      src={src}
      loading="lazy"
      referrerPolicy="no-referrer"
    />
  ) : (
    <span className="text-muted-foreground">{attachment.label}</span>
  );
}

function GentlTaskComments({
  taskScope,
  threadRef,
  canComment,
}: {
  taskScope: GentlTaskScope;
  threadRef: ScopedThreadRef;
  canComment: boolean;
}) {
  const gt = useGT();
  const [revision, setRevision] = useState(0);
  const [message, setMessage] = useState("");
  const [replyTo, setReplyTo] = useState<GentlComment | null>(null);
  const [posting, setPosting] = useState(false);
  const [failed, setFailed] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  return (
    <section aria-label={gt("Comments")} className="space-y-3">
      <h3 className="text-base font-semibold">
        <T>Comments</T>
      </h3>
      {canComment && (
        <form
          className="space-y-2 rounded-lg border border-border p-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!message.trim() || posting) return;
            setPosting(true);
            setFailed(false);
            void gentlRequest({ action: "comment", ...taskScope, message, parentId: replyTo?.id })
              .then(
                () => {
                  setMessage("");
                  setReplyTo(null);
                  setRevision((count) => count + 1);
                },
                () => setFailed(true),
              )
              .finally(() => setPosting(false));
          }}
        >
          {replyTo && (
            <div className="flex items-center justify-between gap-2 text-sm">
              <span>
                <T>Replying to</T> {replyTo.author ?? gt("Unknown author")}
              </span>
              <Button size="xs" variant="ghost" disabled={posting} onClick={() => setReplyTo(null)}>
                <T>Cancel reply</T>
              </Button>
            </div>
          )}
          <Textarea
            ref={input}
            rows={3}
            aria-label={gt("New comment")}
            placeholder={gt("New comment")}
            value={message}
            disabled={posting}
            maxLength={30000}
            onChange={(event) => setMessage(event.target.value)}
          />
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={posting || !message.trim()}>
              <SendIcon />
              <T>Send</T>
            </Button>
          </div>
          {failed && (
            <p role="alert" className="text-sm text-destructive">
              <T>Could not post comment.</T>
            </p>
          )}
        </form>
      )}
      <GentlCommentPage
        key={revision}
        taskScope={taskScope}
        threadRef={threadRef}
        onReply={
          canComment && !posting
            ? (comment) => {
                setReplyTo(comment);
                input.current?.focus();
              }
            : undefined
        }
      />
    </section>
  );
}

function GentlCommentPage({
  taskScope,
  threadRef,
  cursor,
  onReply,
}: {
  taskScope: GentlTaskScope;
  threadRef: ScopedThreadRef;
  cursor?: string;
  onReply: ((comment: GentlComment) => void) | undefined;
}) {
  const gt = useGT();
  const page = useGentlData<GentlComments>({ action: "comments", ...taskScope, cursor });
  const [older, setOlder] = useState(false);
  if (!page.value) return <GentlLoadState {...page} />;
  return (
    <>
      {!cursor && page.value.comments.length === 0 && (
        <p className="text-sm text-muted-foreground">
          <T>No comments yet.</T>
        </p>
      )}
      {page.value.comments.map((comment) => (
        <article key={comment.id} className="space-y-2 border-b border-border pb-3">
          <div className="flex flex-wrap items-baseline gap-x-2">
            {comment.parentId && <ReplyIcon aria-hidden className="size-3 text-muted-foreground" />}
            <span className="text-sm font-medium">{comment.author ?? gt("Unknown author")}</span>
            <time className="text-xs text-muted-foreground" dateTime={comment.createdAt}>
              {new Date(comment.createdAt).toLocaleString()}
            </time>
          </div>
          <TaskBody
            body={comment.body}
            scope={taskScope}
            threadRef={threadRef}
            commentId={comment.id}
          />
          {onReply && (
            <Button size="xs" variant="ghost" onClick={() => onReply(comment)}>
              <ReplyIcon />
              <T>Reply</T>
            </Button>
          )}
        </article>
      ))}
      {page.value.nextCursor &&
        (older ? (
          <GentlCommentPage
            taskScope={taskScope}
            threadRef={threadRef}
            cursor={page.value.nextCursor}
            onReply={onReply}
          />
        ) : (
          <Button size="xs" variant="outline" onClick={() => setOlder(true)}>
            <T>Load older comments</T>
          </Button>
        ))}
    </>
  );
}
