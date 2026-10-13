import { useEffect, useMemo, useRef, useState } from "react";
import { operationKey } from "../api/client";

type Draft<D, B> = {
  document?: D;
  filename: string;
  name: string;
  bindings: B;
  key?: string;
};

/** JSON drafts contain portable documents; browser File objects are not stored. */
export function usePortableImport<D extends { format: string }, B>(
  storageKey: string,
  format: string,
  title: (document: D) => string,
) {
  const [initial] = useState<Draft<D, B>>(() => {
    try {
      const value = JSON.parse(localStorage.getItem(storageKey) || "null");
      if (
        value?.document?.format === format &&
        typeof value.filename === "string" &&
        typeof value.name === "string" &&
        value.bindings &&
        typeof value.bindings === "object"
      )
        return value;
    } catch {}
    return { filename: "", name: "", bindings: {} as B };
  });
  const [document, setDocument] = useState(initial.document);
  const [filename, setFilename] = useState(initial.filename);
  const [name, setName] = useState(initial.name);
  const [bindings, setBindings] = useState(initial.bindings);
  const [fileError, setFileError] = useState(false);
  const reading = useRef(0);
  const body = useMemo(
    () =>
      document
        ? { document, name: name.trim() || undefined, bindings }
        : undefined,
    [document, name, bindings],
  );
  const fingerprint = JSON.stringify(body);
  const original = JSON.stringify(
    initial.document
      ? {
          document: initial.document,
          name: initial.name.trim() || undefined,
          bindings: initial.bindings,
        }
      : undefined,
  );
  const key = useMemo(
    () =>
      fingerprint === original &&
      typeof initial.key === "string" &&
      initial.key.length <= 128
        ? initial.key
        : operationKey(),
    [fingerprint, original, initial.key],
  );
  useEffect(() => {
    try {
      if (document)
        localStorage.setItem(
          storageKey,
          JSON.stringify({ document, filename, name, bindings, key }),
        );
      else localStorage.removeItem(storageKey);
    } catch {}
  }, [document, filename, name, bindings, key, storageKey]);
  useEffect(
    () => () => {
      reading.current++;
    },
    [],
  );
  async function read(file?: File) {
    const generation = ++reading.current;
    setDocument(undefined);
    setBindings({} as B);
    setName("");
    setFilename(file?.name || "");
    setFileError(false);
    if (!file) return;
    try {
      if (file.size > 4 * 1024 * 1024) throw Error("size");
      const value = JSON.parse(await file.text()) as D;
      if (value?.format !== format || typeof title(value) !== "string")
        throw Error("format");
      if (generation !== reading.current) return;
      setDocument(value);
      setName(title(value));
    } catch {
      if (generation === reading.current) setFileError(true);
    }
  }
  function clear() {
    try {
      localStorage.removeItem(storageKey);
    } catch {}
    setDocument(undefined);
    setBindings({} as B);
    setName("");
    setFilename("");
    setFileError(false);
  }
  return {
    document,
    filename,
    name,
    setName,
    bindings,
    setBindings,
    fileError,
    key,
    body,
    read,
    clear,
  };
}
