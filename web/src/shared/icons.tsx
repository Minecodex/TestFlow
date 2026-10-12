import type { SVGProps } from "react";

// Shared vector icons follow the documented prototype. Markup is a static source constant.
const paths = {
  "code": "<path d=\"m8 5-6 7 6 7M16 5l6 7-6 7M14 3l-4 18\"/>",
  "lock": "<rect x=\"5\" y=\"10\" width=\"14\" height=\"11\" rx=\"2\"/><path d=\"M8 10V6a4 4 0 0 1 8 0v4\"/>",
  "merge": "<path d=\"M3 4h4c7 0 3 8 10 8h4M3 20h4c7 0 3-8 10-8m0-4 4 4-4 4\"/>",
  "play": "<path d=\"m8 4 12 8-12 8V4Z\"/>",
  "hide": "<path d=\"m3 3 18 18M4 7c-2 2-2 5-2 5s3 7 10 7c3 0 5-1 7-3M9 5h3c7 0 10 7 10 7l-2 3\"/>",
  "grid": "<rect x=\"3\" y=\"3\" width=\"7\" height=\"7\" rx=\"1.5\"/><rect x=\"14\" y=\"3\" width=\"7\" height=\"7\" rx=\"1.5\"/><rect x=\"3\" y=\"14\" width=\"7\" height=\"7\" rx=\"1.5\"/><rect x=\"14\" y=\"14\" width=\"7\" height=\"7\" rx=\"1.5\"/>",
  "repo": "<path d=\"M4 19.5V4a1 1 0 0 1 1-1h14v18H5a2 2 0 0 1 0-4h14\"/><path d=\"M8 7h7M8 10h5\"/>",
  "box": "<path d=\"m12 3 9 5v9l-9 5-9-5V8l9-5Z\"/><path d=\"m3 8 9 5 9-5M12 13v9M7.5 5.5l9 5\"/>",
  "audio": "<path d=\"M3 10v4M7 6v12M11 3v18M15 7v10M19 5v14M23 10v4\"/>",
  "database": "<ellipse cx=\"12\" cy=\"5\" rx=\"8\" ry=\"3\"/><path d=\"M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0\"/>",
  "flow": "<rect x=\"3\" y=\"3\" width=\"6\" height=\"6\" rx=\"1.5\"/><rect x=\"15\" y=\"15\" width=\"6\" height=\"6\" rx=\"1.5\"/><rect x=\"3\" y=\"15\" width=\"6\" height=\"6\" rx=\"1.5\"/><path d=\"M6 9v6M9 6h9v9\"/>",
  "judge": "<path d=\"m12 3 8 4v5c0 5-8 9-8 9s-8-4-8-9V7l8-4Z\"/><path d=\"m8 12 3 3 5-6\"/>",
  "task": "<rect x=\"5\" y=\"4\" width=\"14\" height=\"18\" rx=\"2\"/><path d=\"M9 4V2h6v2M9 9h6M9 13h6M9 17h4\"/>",
  "history": "<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M12 7v5l3 2\"/>",
  "spark": "<path d=\"m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z\"/>",
  "image": "<rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"2\"/><circle cx=\"8\" cy=\"8\" r=\"1.5\"/><path d=\"m3 17 5-5 4 4 4-7 5 8\"/>",
  "branch": "<circle cx=\"6\" cy=\"5\" r=\"2\"/><circle cx=\"6\" cy=\"19\" r=\"2\"/><circle cx=\"18\" cy=\"5\" r=\"2\"/><path d=\"M6 7v10M18 7c0 5-12 1-12 7\"/>",
  "info": "<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M12 11v6M12 7h.01\"/>"
};

function makeIcon(name: keyof typeof paths) {
  return function Icon({ size, className, ...props }: SVGProps<SVGSVGElement> & {size?:number}) {
    return <svg viewBox="0 0 24 24" width={size || "1em"} height={size || "1em"}
      fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" className={`testflow-icon ${className || ""}`} {...props}
      dangerouslySetInnerHTML={{__html:paths[name]}} />;
  };
}
export const RepoIcon = makeIcon("repo");
export const CodeIcon = makeIcon("code");
export const LockIcon = makeIcon("lock");
export const MergeIcon = makeIcon("merge");
export const PlayIcon = makeIcon("play");
export const HideIcon = makeIcon("hide");
export const GridIcon = makeIcon("grid");
export const BoxIcon = makeIcon("box");
export const AudioIcon = makeIcon("audio");
export const DatabaseIcon = makeIcon("database");
export const FlowIcon = makeIcon("flow");
export const JudgeIcon = makeIcon("judge");
export const TaskIcon = makeIcon("task");
export const HistoryIcon = makeIcon("history");
export const SparkIcon = makeIcon("spark");
export const ImageIcon = makeIcon("image");
export const BranchIcon = makeIcon("branch");
export const InfoIcon = makeIcon("info");
