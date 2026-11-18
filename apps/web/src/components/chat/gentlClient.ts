import { useEffect, useState } from "react";
import { resolvePrimaryEnvironmentHttpUrl } from "../../environments/primary";
import { readDesktopPrimaryBearerToken } from "../../environments/primary/desktopAuth";

export interface GentlOption {
  id: string;
  name: string;
  style?: { color?: string; backgroundColor?: string; icon?: string } | null;
}
export interface GentlWorkspace extends GentlOption {
  target: string;
  domainName?: string | null;
}
export interface GentlBoard extends GentlOption {
  structureNames?: string[];
  canEditTasks: boolean;
}
export interface GentlBoardMetadata {
  statuses: GentlOption[];
  priorities: GentlOption[];
  types: GentlOption[];
  tags: GentlOption[];
  users: GentlOption[];
  sprints?: (GentlOption & { status?: string; endDate?: string | null })[];
  permissions: { createTasks: boolean; updateTasks: boolean; deleteTasks: boolean };
}
export interface GentlTask extends GentlOption {
  uuid: string;
  boardId: string;
  status?: GentlOption | null;
  priority?: GentlOption | null;
  type?: GentlOption | null;
  assignedTo?: {
    user: { id: string; firstName?: string | null; lastName?: string | null } | null;
  }[];
  tags?: GentlOption[];
  dueDate?: string | null;
}
export interface GentlBody {
  markdown: string;
  truncated: boolean;
  originalImages?: Record<string, string>;
  attachments: {
    id: string;
    label: string;
    kind: "image" | "video" | "file";
    url?: string;
    previewable?: boolean;
  }[];
}
export interface GentlDetail {
  task: GentlTask;
  description: GentlBody;
}
export interface GentlComment {
  id: string;
  parentId: string | null;
  createdAt: string;
  author: string | null;
  body: GentlBody;
}
export interface GentlComments {
  comments: GentlComment[];
  nextCursor?: string;
}

export interface GentlScope {
  target: string;
  instanceId: string;
}
export interface GentlTaskScope extends GentlScope {
  taskId: string;
}

export async function gentlRequest<T>(request: object | string, signal?: AbortSignal): Promise<T> {
  const token = await readDesktopPrimaryBearerToken();
  const response = await fetch(resolvePrimaryEnvironmentHttpUrl("/api/gentl/tasks"), {
    method: "POST",
    credentials: token ? "omit" : "include",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: typeof request === "string" ? request : JSON.stringify(request),
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw new Error(response.status === 403 ? "forbidden" : "unavailable");
  const data = await response.json();
  if (data?.failure) throw new Error(data.failure);
  return data as T;
}

export function useGentlData<T>(request: object | null, revision = 0, enabled = true) {
  const body = request === null ? null : JSON.stringify(request);
  const [result, setResult] = useState<{
    body: string;
    revision: number;
    retry: number;
    value?: T;
    failed: boolean;
  }>();
  const [retry, setRetry] = useState(0);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Fetch and cancel as the Gentl selection changes.
  useEffect(() => {
    if (body === null || !enabled) return;
    const controller = new AbortController();
    void gentlRequest<T>(body, controller.signal).then(
      (value) => {
        if (!controller.signal.aborted) setResult({ body, revision, retry, value, failed: false });
      },
      () => {
        if (!controller.signal.aborted) setResult({ body, revision, retry, failed: true });
      },
    );
    return () => controller.abort();
  }, [body, enabled, revision, retry]);
  const current =
    result?.body === body && result.revision === revision && result.retry === retry
      ? result
      : undefined;
  return {
    value: current?.value,
    failed: current?.failed === true,
    retry: () => {
      setRetry((count) => count + 1);
    },
  };
}
