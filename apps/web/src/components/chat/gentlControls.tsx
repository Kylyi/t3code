import { T } from "gt-react";
import type { CSSProperties } from "react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import type { GentlOption } from "./gentlClient";

export function GentlPicker({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: string | null;
  options: readonly GentlOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <Select
      items={options.map(({ id, name }) => ({ value: id, label: name }))}
      value={value}
      disabled={disabled ?? false}
      onValueChange={(next) => {
        if (next !== null) onChange(next);
      }}
    >
      <SelectTrigger aria-label={label} size="sm">
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectPopup>
        {options.map((item) => (
          <SelectItem key={item.id} value={item.id}>
            {item.name}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

export function GentlLoadState({ failed, retry }: { failed: boolean; retry: () => void }) {
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-2 px-3 py-4 text-sm text-muted-foreground"
    >
      {failed ? (
        <>
          <T>Could not load Gentl.</T>
          <Button size="xs" variant="outline" onClick={retry}>
            <T>Retry</T>
          </Button>
        </>
      ) : (
        <T>Loading Gentl…</T>
      )}
    </div>
  );
}

export function GentlStatus({
  status,
}: {
  status: GentlOption & { style?: { color?: string } | null };
}) {
  const color = status.style?.color;
  const style =
    color && /^#[0-9a-f]{6}$/i.test(color) ? ({ "--label": color } as CSSProperties) : undefined;
  return (
    <Badge variant={style ? "label" : "secondary"} style={style}>
      {status.name}
    </Badge>
  );
}
