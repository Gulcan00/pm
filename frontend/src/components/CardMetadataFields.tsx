import { useId } from "react";
import type { CardMetadata, Priority } from "@/lib/kanban";

export const CardMetadataFields = ({ value, onChange }: {
  value: CardMetadata;
  onChange: (value: CardMetadata) => void;
}) => {
  const id = useId();
  return (
  <div className="grid gap-3 text-sm">
    <div className="grid gap-1">
      <label htmlFor={`${id}-priority`}>Priority</label>
      <select id={`${id}-priority`} className="workspace-input" value={value.priority} onChange={(event) => onChange({ ...value, priority: event.target.value as Priority })}>
        <option value="low">Low</option><option value="medium">Medium</option>
        <option value="high">High</option><option value="urgent">Urgent</option>
      </select>
    </div>
    <label className="grid gap-1">Due date
      <input className="workspace-input" type="date" value={value.dueDate ?? ""} onChange={(event) => onChange({ ...value, dueDate: event.target.value || null })} />
    </label>
  </div>
  );
};
