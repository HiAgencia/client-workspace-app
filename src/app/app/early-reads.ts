import type { Day } from "@/lib/dates";

export function treeInput(day: Day): Record<string, unknown> {
  return { today: day, withMail: true, withNotes: true };
}

export const EARLY_TREE =
  '(function(){try{var d=new Date(),p=function(n){return(n<10?"0":"")+n},' +
  'b=JSON.stringify({today:d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate()),withMail:true,withNotes:true}),' +
  'u="/api/tools/list_tree",s=window.AbortSignal&&AbortSignal.timeout?AbortSignal.timeout(20000):undefined,' +
  'r=fetch(u,{method:"POST",headers:{"Content-Type":"application/json"},body:b,cache:"no-store",signal:s});' +
  'r.catch(function(){});(window.__cwEarly=window.__cwEarly||{})[u+" "+b]=r}catch(e){}})();';
