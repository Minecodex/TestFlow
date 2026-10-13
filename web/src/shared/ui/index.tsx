import { useIsMutating } from "@tanstack/react-query";
import {
  Button,
  Checkbox,
  Input,
  Label,
  ListBox,
  Modal,
  Select,
  TextArea,
  TextField,
} from "@heroui/react";
import { AlertCircle, ArrowUp, Box, Pencil, Plus, Trash2, X } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type ComponentProps,
} from "react";
import { useMessages } from "../../i18n";
import type { Schema, PortField } from "../api/types";
import { formats } from "../api/types";
import { ApiError } from "../api/client";
import { schemaIssues } from "../schema/validation";
import { InfoIcon } from "../icons";
// A grid may move DOM focus to its cell before the dialog commits.
// Retain the pressed control during that commit so nested dialogs restore it.
let dialogPressTarget: HTMLElement | null = null;
export function Action({
  children,
  primary = false,
  danger = false,
  action,
  className,
  ...props
}: ComponentProps<typeof Button> & {
  primary?: boolean;
  danger?: boolean;
  action?: string;
}) {
  const busy = useIsMutating() > 0;
  return (
    <Button
      className={`testflow-btn ${primary ? "testflow-primary" : ""} ${danger ? "testflow-danger" : ""} ${props.variant === "ghost" ? "testflow-ghost" : ""} ${props.size === "sm" ? "testflow-btn-sm" : ""} ${className || ""}`}
      variant={primary ? "primary" : danger ? "danger" : "outline"}
      data-a={action}
      {...props}
      isDisabled={props.isDisabled || (busy && !props.isPending)}
      onPress={(event) => {
        const target =
          event.target instanceof HTMLElement ? event.target : null;
        dialogPressTarget = target;
        props.onPress?.(event);
        queueMicrotask(() => {
          if (dialogPressTarget === target) dialogPressTarget = null;
        });
      }}
    >
      {children}
    </Button>
  );
}
export function Text({
  label,
  value,
  onChange,
  multiline = false,
  type = "text",
  hint,
  required,
  disabled,
  name,
  placeholder,
  onKeyDown,
}: {
  label: string;
  value: string | number;
  onChange: (v: string) => void;
  multiline?: boolean;
  type?: string;
  hint?: string;
  required?: boolean;
  disabled?: boolean;
  name?: string;
  placeholder?: string;
  onKeyDown?: ComponentProps<typeof Input>["onKeyDown"];
}) {
  return (
    <TextField
      className="testflow-field"
      isDisabled={disabled}
      isRequired={required}
      type={type}
      name={name}
      value={String(value)}
      onChange={onChange}
    >
      <Label>{label}</Label>
      {multiline ? (
        <TextArea
          className="testflow-input testflow-textarea"
          placeholder={placeholder}
        />
      ) : (
        <Input className="testflow-input" placeholder={placeholder} onKeyDown={onKeyDown} />
      )}
      {hint && <span className="testflow-hint">{hint}</span>}
    </TextField>
  );
}
export function EditAction({ children, className, ...props }: Omit<ComponentProps<typeof Action>, "children"> & {children?: ReactNode}) {
  const t = useMessages();
  return <Action {...props} size="sm" variant="outline" isIconOnly={false} className={`testflow-resource-action testflow-edit-action ${className || ""}`}><Pencil />{children || t.common.edit}</Action>;
}
export function DeleteAction({ children, className, ...props }: Omit<ComponentProps<typeof Action>, "children"> & {children?: ReactNode}) {
  const t = useMessages();
  return <Action {...props} size="sm" variant="outline" danger={false} isIconOnly={false} className={`testflow-resource-action testflow-delete-action ${className || ""}`}><Trash2 />{children || t.common.delete}</Action>;
}
export function Choice({
  label,
  value,
  options,
  onChange,
  disabled,
  className = "",
}: {
  label: string;
  value?: string;
  options: { id: string; name: string }[];
  onChange: (v: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const t = useMessages();
  return (
    <Select
      className={`testflow-field testflow-select ${className}`}
      aria-label={label}
      selectedKey={value || null}
      placeholder={t.common.select}
      onSelectionChange={(key) => onChange(String(key || ""))}
      isDisabled={disabled}
    >
      <Label>{label}</Label>
      <Select.Trigger className="testflow-input testflow-select-trigger">
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover className="testflow-select-popover">
        <ListBox>
          {options.map((o) => (
            <ListBox.Item
              className="testflow-select-option"
              key={o.id}
              id={o.id}
              textValue={o.name}
            >
              {o.name}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}
export function Check({
  children,
  value,
  onChange,
  disabled,
}: {
  children: ReactNode;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <Checkbox
      className="testflow-checkbox"
      isSelected={value}
      onChange={onChange}
      isDisabled={disabled}
    >
      <Checkbox.Content>
        <Checkbox.Control>
          <Checkbox.Indicator />
        </Checkbox.Control>
        <Label>{children}</Label>
      </Checkbox.Content>
    </Checkbox>
  );
}
export function Dialog({
  title,
  children,
  footer,
  onClose,
  wide = false,
  drawer = false,
  className = "",
}: {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  wide?: boolean;
  drawer?: boolean;
  className?: string;
}) {
  const t = useMessages();
  const submitting = useIsMutating() > 0;
  const opener = useRef(
    dialogPressTarget ||
      (document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null),
  );
  useEffect(() => {
    const target = opener.current;
    return () => {
      requestAnimationFrame(() => {
        if (target?.isConnected) target.focus({ preventScroll: true });
      });
    };
  }, []);
  return (
    <Modal
      isOpen
      onOpenChange={(open) => {
        if (!open && !submitting) onClose();
      }}
    >
      <Modal.Backdrop className="testflow-overlay" isDismissable={!submitting}>
        <Modal.Container
          className="testflow-modal-container"
          size={wide ? "lg" : "md"}
          placement="center"
        >
          <Modal.Dialog
            className={`testflow-dialog ${wide ? "testflow-dialog-wide" : ""} ${drawer ? "testflow-drawer" : ""} ${className}`}
          >
            <Modal.Header className="testflow-dialog-header">
              <Modal.Heading>{title}</Modal.Heading>
              <Action
                className="testflow-close"
                aria-label={t.common.close}
                isDisabled={submitting}
                isIconOnly
                size="sm"
                onPress={onClose}
                action={drawer ? "close-drawer" : "close-modal"}
              >
                <X />
              </Action>
            </Modal.Header>
            <Modal.Body className="testflow-dialog-body">{children}</Modal.Body>
            {footer && (
              <Modal.Footer className="testflow-dialog-footer">
                {footer}
              </Modal.Footer>
            )}
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
export function Notice({
  children,
  error = false,
}: {
  children: ReactNode;
  error?: boolean;
}) {
  return (
    <div
      role={error ? "alert" : "status"}
      className={`testflow-notice ${error ? "testflow-error" : ""}`}
    >
      {error ? <AlertCircle /> : <InfoIcon />}
      <div>{children}</div>
    </div>
  );
}
export function Failure({ error }: { error: unknown }) {
  const t = useMessages();
  if (!error) return null;
  const fallback =
    error instanceof Error
      ? error.message
      : typeof error === "object" && "message" in error
        ? String(error.message)
        : String(error);
  const message =
    error instanceof ApiError
      ? error.code === "invalid_login"
        ? t.auth.error
        : t.common.errors[error.code as keyof typeof t.common.errors] ||
          fallback
      : fallback;
  return (
    <Notice error>
      {message}
      {error instanceof ApiError &&
        Object.keys(error.fields || {}).length > 0 && (
          <pre>{JSON.stringify(error.fields, null, 2)}</pre>
        )}
      {error instanceof ApiError && error.requestId && (
        <small>{error.requestId}</small>
      )}
    </Notice>
  );
}
export function Head({
  title,
  actions,
  meta,
}: {
  title: string;
  actions?: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <header className="testflow-page-heading">
      <div className="testflow-heading-title">
        <h1>{title}</h1>
        {meta && <span className="testflow-heading-meta">{meta}</span>}
      </div>
      <div className="testflow-row">{actions}</div>
    </header>
  );
}
export function Panel({
  title,
  children,
  actions,
  className = "",
}: {
  title?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`testflow-panel ${className}`}>
      {title && (
        <div className="testflow-panel-heading">
          <h2>{title}</h2>
          {actions}
        </div>
      )}
      <div className="testflow-panel-body">{children}</div>
    </section>
  );
}
export function Empty({
  text,
  children,
}: {
  text: string;
  children?: ReactNode;
}) {
  return (
    <div className="testflow-empty-state">
      <Box />
      <h3>{text}</h3>
      {children}
    </div>
  );
}
export function Badge({
  children,
  state = "",
}: {
  children: ReactNode;
  state?: string;
}) {
  return (
    <span className={`testflow-badge testflow-state-${state}`}>{children}</span>
  );
}
export function Status({ value, label }: { value: string; label?: string }) {
  const t = useMessages();
  return (
    <Badge state={value}>
      <span className="testflow-dot" aria-hidden="true" />
      {label || t.common.states[value as keyof typeof t.common.states] || value}
    </Badge>
  );
}
export function Chips({ schema }: { schema?: Schema | null }) {
  const t = useMessages();
  return (
    <div className="testflow-chips">
      {schema?.fields.map((f) => (
        <span className={`testflow-chip testflow-type-${f.type}`} key={f.name}>
          {f.name}{" "}
          <span className="testflow-tiny">
            {t.common.types[f.type]}
            {f.stream ? " ~" : ""}
          </span>
        </span>
      ))}
    </div>
  );
}
export function Json({ value }: { value: unknown }) {
  return <pre className="testflow-json">{JSON.stringify(value, null, 2)}</pre>;
}
export function JsonEditor<T = Record<string, unknown>>({
  label,
  value,
  onChange,
  onValid,
  objectOnly = true,
}: {
  label: string;
  value: T;
  objectOnly?: boolean;
  onChange: (v: T) => void;
  onValid?: (v: boolean) => void;
}) {
  const [text, setText] = useState(JSON.stringify(value, null, 2));
  const [error, setError] = useState("");
  return (
    <div>
      <Text
        label={label}
        multiline
        value={text}
        onChange={(v) => {
          setText(v);
          try {
            const result = JSON.parse(v);
            if (
              objectOnly &&
              (!result || typeof result !== "object" || Array.isArray(result))
            )
              throw new Error("JSON object required");
            onChange(result);
            setError("");
            onValid?.(true);
          } catch (e) {
            setError(e instanceof Error ? e.message : "Invalid JSON");
            onValid?.(false);
          }
        }}
      />
      {error && <Notice error>{error}</Notice>}
    </div>
  );
}
export function SchemaEditor({
  value,
  onChange,
  stream = true,
}: {
  value: Schema;
  onChange: (v: Schema) => void;
  stream?: boolean;
}) {
  const t = useMessages();
  const patch = (i: number, changes: Partial<PortField>) =>
    onChange({
      fields: value.fields.map((f, n) => (n === i ? { ...f, ...changes } : f)),
    });
  return (
    <div className="testflow-stack">
      {value.fields.map((f, i) => (
        <div className="testflow-schema-row" key={i}>
          <span>{i + 1}</span>
          <Text
            label={t.common.fieldName}
            value={f.name}
            onChange={(name) => patch(i, { name })}
          />
          <Choice
            label={t.common.fieldType}
            value={f.type}
            options={Object.keys(formats).map((id) => ({ id, name: t.common.types[id as keyof typeof t.common.types] }))}
            onChange={(type) =>
              patch(i, {
                type: type as PortField["type"],
                format: formats[type as keyof typeof formats],
                stream: type === "JSON" ? false : f.stream,
              })
            }
          />
          <Text
            label={t.common.format}
            value={f.format}
            onChange={(format) => patch(i, { format })}
          />
          {stream && (
            <Check
              value={!!f.stream}
              disabled={f.type === "JSON"}
              onChange={(v) => patch(i, { stream: v })}
            >
              {t.common.stream}
            </Check>
          )}
          <Action
            isIconOnly
            aria-label={t.common.moveUp}
            isDisabled={!i}
            onPress={() => {
              const fields = [...value.fields];
              [fields[i], fields[i - 1]] = [fields[i - 1], fields[i]];
              onChange({ fields });
            }}
            action="schema-up"
          >
            <ArrowUp />
          </Action>
          <DeleteAction
            size="sm"
            aria-label={t.common.removeField}
            onPress={() =>
              onChange({ fields: value.fields.filter((_, n) => n !== i) })
            }
            action="schema-remove"
          >
            {t.common.delete}
          </DeleteAction>
        </div>
      ))}
      <Action
        action="schema-add"
        onPress={() => {
          let number = value.fields.length + 1;
          while (value.fields.some((f) => f.name === `field_${number}`))
            number++;
          onChange({
            fields: [
              ...value.fields,
              {
                name: `field_${number}`,
                type: "Text",
                format: "UTF-8",
                stream: false,
              },
            ],
          });
        }}
      >
        <Plus />
        {t.common.addField}
      </Action>
      {schemaIssues(value).map((issue, index) => (
        <Notice error key={index}>
          {issue.field && <code>{issue.field} · </code>}
          {
            t.common[
              (
                {
                  empty: "schemaEmpty",
                  name: "schemaName",
                  duplicate: "schemaDuplicate",
                  format: "schemaFormat",
                } as const
              )[issue.kind]
            ]
          }
        </Notice>
      ))}
    </div>
  );
}
export function Pagination({
  page,
  total,
  size = 30,
  onChange,
}: {
  page: number;
  total: number;
  size?: number;
  onChange: (v: number) => void;
}) {
  const t = useMessages();
  if (page === 1 && total <= size) return null;
  return (
    <div className="testflow-pagination">
      <span>
        {total} {t.common.records} · {page} /{" "}
        {Math.max(1, Math.ceil(total / size))}
      </span>
      <Action
        size="sm"
        isDisabled={page === 1}
        onPress={() => onChange(page - 1)}
      >
        {t.common.previous}
      </Action>
      <Action
        size="sm"
        isDisabled={page * size >= total}
        onPress={() => onChange(page + 1)}
      >
        {t.common.next}
      </Action>
    </div>
  );
}
export function download(name: string, value: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function useUnload(dirty: boolean) {
  useEffect(() => {
    const listener = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", listener);
    return () => window.removeEventListener("beforeunload", listener);
  }, [dirty]);
}

import { Table } from "@heroui/react";
export function DataTable({
  headers,
  rows,
  label,
  className = "",
}: {
  headers: string[];
  rows: { id: string; cells: ReactNode[] }[];
  label: string;
  className?: string;
}) {
  return (
    <Table className={`testflow-table-wrap ${className}`}>
      <Table.Content aria-label={label}>
        <Table.Header>
          {headers.map((h, i) => (
            <Table.Column key={i} isRowHeader={i === 0}>
              {h}
            </Table.Column>
          ))}
        </Table.Header>
        <Table.Body>
          {rows.map((row) => (
            <Table.Row key={row.id} id={row.id}>
              {row.cells.map((cell, i) => (
                <Table.Cell key={i}>{cell}</Table.Cell>
              ))}
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Content>
    </Table>
  );
}
