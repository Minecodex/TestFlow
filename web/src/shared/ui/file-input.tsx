import { Label } from "@heroui/react";
import { useId } from "react";
/** File inputs stay uncontrolled so text-field state cannot clear a chosen FileList. */
export function FileInput({
  label,
  accept,
  multiple = false,
  disabled = false,
  onChange,
}: {
  label: string;
  accept: string;
  multiple?: boolean;
  disabled?: boolean;
  onChange: (files: File[]) => void;
}) {
  const id = useId();
  return (
    <div className="testflow-field testflow-upload">
      <Label htmlFor={id}>{label}</Label>
      <input
        id={id}
        className="testflow-input testflow-file-input"
        type="file"
        aria-label={label}
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        onChange={(event) =>
          onChange(Array.from(event.currentTarget.files || []))
        }
      />
    </div>
  );
}
