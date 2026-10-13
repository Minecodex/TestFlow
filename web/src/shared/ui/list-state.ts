import { useSearchParams } from "react-router-dom";
export function useListState() {
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get("page") || 1) || 1);
  const search = params.get("q") || "";
  const onPage = (value: number) => {
    const next = new URLSearchParams(params);
    next.set("page", String(value));
    setParams(next);
  };
  const onSearch = (value: string) => {
    const next = new URLSearchParams(params);
    next.delete("page");
    if (value) next.set("q", value);
    else next.delete("q");
    setParams(next);
  };
  return {
    params,
    page,
    search,
    onPage,
    onSearch,
    query: `page=${page}&search=${encodeURIComponent(search)}`,
  };
}
