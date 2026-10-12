import { useEffect, useState } from "react";
import { restoreDraft } from "./draft-conflict";

/** A form keeps its opening revision until the user explicitly reviews a newer revision. */
export function useVersionedDraft<T>(key: string, version: number, initial: T) {
  const [restored] = useState(()=>restoreDraft(key,version,initial));
  const [data,setData] = useState<T>(restored.data);
  const [baseVersion,setBaseVersion] = useState(restored.baseVersion);
  useEffect(()=>{
    try {localStorage.setItem(key,JSON.stringify({base_version:baseVersion,data}));} catch {}
  },[key,data,baseVersion]);
  return { data,setData,baseVersion,setBaseVersion,clear:()=>{try{localStorage.removeItem(key);}catch{}} };
}
