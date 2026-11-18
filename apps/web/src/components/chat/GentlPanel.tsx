import type { ScopedThreadRef } from "@t3tools/contracts";
import { AuthPreviewOperateScope } from "@t3tools/contracts";
import { T } from "gt-react";
import { useEffect, useEffectEvent, useState } from "react";

import { usePreviewAvailable } from "../../browser/previewRuntime";
import { useThreadPreviewState } from "../../previewStateStore";
import { useRightPanelStore } from "../../rightPanelStore";
import { previewEnvironment } from "../../state/preview";
import { useEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { openPreviewSession } from "../preview/openPreviewSession";
import { PreviewPanel } from "../preview/PreviewPanel";
import { usePreviewSession } from "../preview/usePreviewSession";
import { Button } from "../ui/button";

const GENTL_URL = "https://tasks.gentl.tech/";

export function GentlPanel({
  threadRef,
  resourceId,
  visible,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly resourceId: string | undefined;
  readonly visible: boolean;
}) {
  const available = usePreviewAvailable(threadRef.environmentId);
  const canOperate = useEnvironmentScope(threadRef.environmentId, AuthPreviewOperateScope);
  const openPreview = useAtomCommand(previewEnvironment.open, { reportFailure: false });
  const closePreview = useAtomCommand(previewEnvironment.close, "preview close");
  usePreviewSession(threadRef);
  const state = useThreadPreviewState(threadRef);
  const hasSession = resourceId !== undefined && state.sessions[resourceId] !== undefined;
  const needsSession = !hasSession && (resourceId === undefined || state.listLoaded);
  const [attempt, setAttempt] = useState(0);
  const [failedAttempt, setFailedAttempt] = useState<number | null>(null);
  const { environmentId, threadId } = threadRef;

  const openGentl = useEffectEvent(
    (ref: ScopedThreadRef, attempt: number, isDisposed: () => boolean) => {
      void openPreviewSession({
        openPreview,
        threadRef: ref,
        url: GENTL_URL,
        viewport: { _tag: "fill" },
        reveal: false,
      }).then((result) => {
        if (result._tag === "Failure") {
          if (!isDisposed()) setFailedAttempt(attempt);
          return;
        }
        const tabId = result.value.tabId;
        if (isDisposed() || !useRightPanelStore.getState().attachGentlBrowser(ref, tabId)) {
          void closePreview({
            environmentId: ref.environmentId,
            input: { threadId: ref.threadId, tabId },
          });
        }
      });
    },
  );

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Open the preview session when this surface becomes visible.
  useEffect(() => {
    if (!visible || !available || !canOperate || !needsSession) return;
    let disposed = false;
    openGentl({ environmentId, threadId }, attempt, () => disposed);
    return () => {
      disposed = true;
    };
  }, [attempt, available, canOperate, environmentId, needsSession, threadId, visible]);

  if (!available || !canOperate || hasSession) {
    return (
      <PreviewPanel
        mode="embedded"
        threadRef={threadRef}
        tabId={resourceId ?? null}
        visible={visible}
        contentOnly
      />
    );
  }
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-sm text-muted-foreground">
      {failedAttempt === attempt ? (
        <>
          <T>Could not open Gentl.</T>
          <Button size="sm" variant="outline" onClick={() => setAttempt((count) => count + 1)}>
            <T>Retry</T>
          </Button>
        </>
      ) : (
        <T>Loading Gentl…</T>
      )}
    </div>
  );
}
