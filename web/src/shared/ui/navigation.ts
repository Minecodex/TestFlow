export function safeReturn(value: string | null | undefined, fallback: string) {
  return value?.startsWith("/") &&
    !value.startsWith("//") &&
    !value.includes("\\") &&
    !/[\u0000-\u001f]/.test(value)
    ? value
    : fallback;
}
export function detailHref(
  path: string,
  returnTo: string,
  fields: Record<string, string> = {},
) {
  return path + "?" + new URLSearchParams({ ...fields, return: returnTo });
}
