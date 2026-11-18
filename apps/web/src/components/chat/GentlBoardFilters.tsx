import { T, useGT } from "gt-react";
import { Button } from "../ui/button";
import type { GentlBoardMetadata, GentlOption } from "./gentlClient";
import { GentlChoices, GentlPicker } from "./gentlControls";

export interface GentlTaskFilters {
  sprintId?: string | null;
  userIds?: string[];
  tagIds?: string[];
  statusId?: string;
  priorityId?: string;
  typeId?: string;
}

const ALL = "";
const NO_SPRINT = "__gentl_no_sprint";

export function GentlBoardFilters({
  metadata,
  viewerId,
  value,
  onChange,
}: {
  metadata: GentlBoardMetadata;
  viewerId: string | null | undefined;
  value: GentlTaskFilters;
  onChange: (filters: GentlTaskFilters) => void;
}) {
  const gt = useGT();
  const selectedUsers = value.userIds ?? [];
  const onlyMe = !!viewerId && selectedUsers.length === 1 && selectedUsers[0] === viewerId;
  const enumField = (
    label: string,
    field: "statusId" | "priorityId" | "typeId",
    options: GentlOption[],
  ) => (
    <GentlPicker
      label={label}
      value={value[field] ?? null}
      options={[{ id: ALL, name: gt("All") }, ...options]}
      onChange={(id) => {
        const next = { ...value };
        if (id) next[field] = id;
        else delete next[field];
        onChange(next);
      }}
    />
  );
  return (
    <div className="max-h-[45vh] shrink-0 space-y-3 overflow-y-auto border-b border-border p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <GentlPicker
          label={gt("Sprint")}
          value={value.sprintId === null ? NO_SPRINT : (value.sprintId ?? null)}
          options={[
            { id: ALL, name: gt("All sprints") },
            { id: NO_SPRINT, name: gt("No sprint") },
            ...(metadata.sprints ?? []),
          ]}
          onChange={(id) => {
            const next = { ...value };
            if (id === ALL) delete next.sprintId;
            else next.sprintId = id === NO_SPRINT ? null : id;
            onChange(next);
          }}
        />
        {enumField(gt("Status"), "statusId", metadata.statuses)}
        {enumField(gt("Priority"), "priorityId", metadata.priorities)}
        {enumField(gt("Type"), "typeId", metadata.types)}
      </div>
      {viewerId && (
        <Button
          variant={onlyMe ? "default" : "outline"}
          aria-pressed={onlyMe}
          size="xs"
          onClick={() => onChange({ ...value, userIds: onlyMe ? [] : [viewerId] })}
        >
          <T>My tasks</T>
        </Button>
      )}
      <GentlChoices
        label={gt("Assignees")}
        options={metadata.users}
        selected={selectedUsers}
        disabled={false}
        onChange={(userIds) => onChange({ ...value, userIds })}
      />
      <GentlChoices
        label={gt("Tags")}
        options={metadata.tags}
        selected={value.tagIds ?? []}
        disabled={false}
        onChange={(tagIds) => onChange({ ...value, tagIds })}
      />
      <Button variant="ghost" size="xs" onClick={() => onChange({})}>
        <T>Clear filters</T>
      </Button>
    </div>
  );
}
