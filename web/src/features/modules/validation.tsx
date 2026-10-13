import { useState } from "react";
import { useMessages } from "../../i18n";
import { write } from "../../shared/api/client";
import { useOperation, useWrite } from "../../shared/api/hooks";
import { useOperationKeys } from "../../shared/api/operation-keys";
import type {
  Module,
  Operation,
  Resource,
  Runtime,
} from "../../shared/api/types";
import { Action, Failure, Notice } from "../../shared/ui";
import { OperationStatus } from "../../shared/ui/resources";
export function ModuleValidation({
  module,
  runtime,
}: {
  module: Resource<Module>;
  runtime: Runtime;
}) {
  const t = useMessages();
  const [operation, setOperation] = useState<string>();
  const [submitted, setSubmitted] = useState("");
  const signature = JSON.stringify(runtime);
  const status = useOperation(operation);
  const intents = useOperationKeys();
  const validate = useWrite(() =>
    write<Operation>(
      `/modules/${module.id}/validate?version=${module.selected_version}`,
      runtime,
      "POST",
      intents.key(
        module.id,
        { version: module.selected_version, runtime },
        status.data,
      ),
    ),
  );
  return (
    <div className="testflow-stack">
      <Action
        action="validate-module"
        isPending={validate.isPending}
        isDisabled={
          (!!runtime.code_mount && !runtime.code_mount.commit) ||
          (submitted === signature &&
            ["queued", "running"].includes(status.data?.state || ""))
        }
        onPress={() =>
          validate.mutate(undefined, {
            onSuccess: (op) => {
              intents.accepted(module.id, op);
              setSubmitted(signature);
              setOperation(op.id);
            },
          })
        }
      >
        {t.modules.validate}
      </Action>
      <Failure error={validate.error} />
      {operation && submitted !== signature ? (
        <Notice>{t.modules.runtimeChanged}</Notice>
      ) : (
        <OperationStatus id={operation} />
      )}
    </div>
  );
}
