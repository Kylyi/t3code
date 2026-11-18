import { T } from "gt-react";
import { BugIcon, Columns2Icon, MinusIcon, TriangleAlertIcon } from "lucide-react";
import type { CSSProperties } from "react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
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

function GentlBadgeIcon({ icon }: { icon: string }) {
  switch (icon) {
    case "material-symbols:warning-rounded":
      return <TriangleAlertIcon aria-hidden />;
    case "mdi:bug-outline":
      return <BugIcon aria-hidden />;
    case "octicon:dash-16":
      return <MinusIcon aria-hidden />;
    case "lucide:columns-2":
      return <Columns2Icon aria-hidden />;
    default:
      return null;
  }
}

export function GentlBadge({ option }: { option: GentlOption }) {
  const color = option.style?.color;
  const background = option.style?.backgroundColor;
  const icon = option.style?.icon;
  const style =
    color && /^#[0-9a-f]{6}$/i.test(color)
      ? ({
          "--label": color,
          ...(background && /^(?:#[0-9a-f]{6}|rgba?\([\d.,% ]+\))$/i.test(background)
            ? { backgroundColor: background }
            : {}),
        } as CSSProperties)
      : undefined;
  return (
    <Badge variant={style ? "label" : "secondary"} style={style}>
      {icon && <GentlBadgeIcon icon={icon} />}
      {option.name}
    </Badge>
  );
}

export function GentlChoices({
  label,
  options,
  selected,
  onChange,
  disabled,
}: {
  label: string;
  options: GentlOption[];
  selected: string[];
  onChange: (value: string[]) => void;
  disabled: boolean;
}) {
  if (!options.length) return null;
  return (
    <fieldset className="space-y-1" disabled={disabled}>
      <legend className="text-sm">{label}</legend>
      <div className="flex max-h-32 flex-wrap gap-x-3 gap-y-2 overflow-auto rounded-lg border border-border p-2">
        {options.map(({ id, name }) => (
          <label key={id} className="flex items-center gap-1.5 text-sm">
            <Checkbox
              checked={selected.includes(id)}
              onCheckedChange={(checked) =>
                onChange(checked ? [...selected, id] : selected.filter((item) => item !== id))
              }
            />
            <span>{name}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
