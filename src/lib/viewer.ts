import {
  Eraser,
  Highlighter,
  MousePointer2,
  Pencil,
  Type,
  type Icon,
} from "@/components/icons";
import type { Tool } from "./types";
// Document ink values are user data, independent of the interface theme.
export const COLORS = [
  "#f4ca43",
  "#92d6ad",
  "#a99bec",
  "#ee9caf",
  "#4d79d8",
  "#29344a",
];
export const TOOL_ITEMS: {
  id: Tool;
  label: string;
  icon: Icon;
  shortcut: "V" | "H" | "P" | "T" | "E";
}[] = [
  { id: "select", label: "선택", icon: MousePointer2, shortcut: "V" },
  { id: "highlight", label: "하이라이트", icon: Highlighter, shortcut: "H" },
  { id: "pen", label: "펜", icon: Pencil, shortcut: "P" },
  { id: "text", label: "글씨", icon: Type, shortcut: "T" },
  { id: "eraser", label: "지우개", icon: Eraser, shortcut: "E" },
];
