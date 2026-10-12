import { useQuery } from "@tanstack/react-query";
import { getJson } from "../../shared/api/client";
import type { Page, Task } from "../../shared/api/types";

export function useTaskOptions(selectedId?: string) {
  const query = useQuery({ queryKey:["options","tasks"], queryFn:async({signal})=>{
    const items = new Map<string,Task>();
    let page = 1, total = 0;
    do {
      const result = await getJson<Page<Task>>(`/tasks?page=${page++}&page_size=100`,signal);
      total = result.total;
      result.items.forEach(task=>items.set(task.id,task));
      if(!result.items.length) break;
    } while((page-1)*100<total);
    return [...items.values()];
  }});
  const selected = useQuery({queryKey:["task",selectedId],
    queryFn:({signal})=>getJson<Task>("/tasks/"+selectedId,signal),
    enabled:!!selectedId && query.isSuccess && !query.data.some(task=>task.id===selectedId),
  });
  return {...query,error:query.error || selected.error,
    data:selected.data && !query.data?.some(task=>task.id===selected.data.id)
      ? [...(query.data || []),selected.data] : query.data};
}
