import Ajv2020 from "ajv/dist/2020.js";
import type { ErrorObject, ValidateFunction } from "ajv";
import type { Schema } from "../api/types";

// ZIP v1 and the server both use Draft 2020-12. Validation never rewrites drafts.
const compiler = new Ajv2020({
  allErrors: true,
  strict: false,
  strictNumbers: true,
  validateFormats: false,
  addUsedSchema: false,
});
const compiled = new Map<string, ValidateFunction>();
export function parameterErrors(
  schema: Record<string, unknown>,
  value: unknown,
) {
  const key = JSON.stringify(schema);
  try {
    let validate = compiled.get(key);
    if (!validate) {
      validate = compiler.compile(schema);
      if (compiled.size > 200) compiled.clear();
      compiled.set(key, validate);
    }
    if (validate(value)) return [];
    return (validate.errors || []).map((error: ErrorObject) => ({
      path: error.instancePath || "/",
      keyword: error.keyword,
      detail: error.message || "",
    }));
  } catch {
    return [
      { path: "/", keyword: "schema", detail: "Invalid parameter Schema" },
    ];
  }
}
export function schemaIssues(schema: Schema) {
  const issues: {
    field: string;
    kind: "empty" | "name" | "duplicate" | "format";
  }[] = [];
  if (!schema.fields.length) issues.push({ field: "", kind: "empty" });
  const names = new Set<string>();
  for (const field of schema.fields) {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(field.name))
      issues.push({ field: field.name, kind: "name" });
    if (names.has(field.name))
      issues.push({ field: field.name, kind: "duplicate" });
    names.add(field.name);
    if (!field.format.trim() || field.format.length > 128)
      issues.push({ field: field.name, kind: "format" });
  }
  return issues;
}
