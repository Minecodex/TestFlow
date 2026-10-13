import { useRef } from "react";
import type { Operation } from "./types";
import { operationKey } from "./client";
/** Keep an uncertain submission's key; rotate only after a known ended operation or changed intent. */
export function useOperationKeys() {
  const intents = useRef(
    new Map<string, { signature: string; key: string; operationId?: string }>(),
  );
  return {
    key(scope: string, value: unknown, last?: Operation | null) {
      const signature = JSON.stringify(value);
      let intent = intents.current.get(scope);
      if (
        !intent ||
        intent.signature !== signature ||
        (last?.id === intent.operationId &&
          !["queued", "running"].includes(last?.state || "queued"))
      ) {
        intent = { signature, key: operationKey() };
        intents.current.set(scope, intent);
      }
      return intent.key;
    },
    accepted(scope: string, operation: Operation) {
      const intent = intents.current.get(scope);
      if (intent) intent.operationId = operation.id;
    },
  };
}
