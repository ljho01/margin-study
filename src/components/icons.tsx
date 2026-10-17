import type { ComponentProps } from "react";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import * as H from "@hugeicons/core-free-icons";

export type IconProps = Omit<ComponentProps<typeof HugeiconsIcon>, "icon">;
export type Icon = (props: IconProps) => React.JSX.Element;

/** Hugeicons with the same defaults as Non; CSS (e.g. size-4) sets the rendered size. */
const icon = (svg: IconSvgElement): Icon => {
  function Icon(props: IconProps) {
    return (
      <HugeiconsIcon
        icon={svg}
        size={20}
        color="currentColor"
        strokeWidth={1.5}
        {...props}
      />
    );
  }
  return Icon;
};

// Names mirror the previous lucide imports so call sites stay unchanged.
export const ArrowDownToLine = icon(H.Download04Icon);
export const ArrowUp = icon(H.ArrowUp02Icon);
export const BookOpen = icon(H.BookOpen01Icon);
export const CheckIcon = icon(H.Tick02Icon);
export const ChevronDown = icon(H.ArrowDown01Icon);
export const ChevronDownIcon = icon(H.ArrowDown01Icon);
export const ChevronLeft = icon(H.ArrowLeft01Icon);
export const ChevronRight = icon(H.ArrowRight01Icon);
export const ChevronRightIcon = icon(H.ArrowRight01Icon);
export const ChevronUpIcon = icon(H.ArrowUp01Icon);
export const CircleCheckIcon = icon(H.CheckmarkCircle02Icon);
export const CircleIcon = icon(H.CircleIcon);
export const Eraser = icon(H.EraserIcon);
export const FileText = icon(H.File02Icon);
export const Folder = icon(H.Folder01Icon);
export const FolderOpen = icon(H.FolderOpenIcon);
export const GripVerticalIcon = icon(H.DragDropVerticalIcon);
export const Highlighter = icon(H.HighlighterIcon);
export const History = icon(H.HistoryIcon);
export const InfoIcon = icon(H.InformationCircleIcon);
export const Loader2 = icon(H.Loading03Icon);
export const Loader2Icon = icon(H.Loading03Icon);
export const LogOut = icon(H.Logout03Icon);
export const MessageSquare = icon(H.BubbleChatIcon);
export const Monitor = icon(H.ComputerIcon);
export const Moon = icon(H.Moon02Icon);
export const MousePointer2 = icon(H.Cursor01Icon);
export const OctagonXIcon = icon(H.CancelCircleIcon);
export const PanelBottom = icon(H.SidebarBottomIcon);
export const PanelLeft = icon(H.SidebarLeftIcon);
export const PanelLeftIcon = icon(H.SidebarLeftIcon);
export const PanelRight = icon(H.SidebarRightIcon);
export const Pencil = icon(H.PencilEdit01Icon);
export const Plus = icon(H.Add01Icon);
export const Play = icon(H.PlayIcon);
export const CornerDownRight = icon(H.CornerDownRightIcon);
export const RefreshCw = icon(H.RefreshIcon);
export const Save = icon(H.FloppyDiskIcon);
export const Settings2 = icon(H.SlidersHorizontalIcon);
export const Square = icon(H.StopIcon);
export const Sun = icon(H.Sun03Icon);
export const Trash2 = icon(H.Delete02Icon);
export const TriangleAlertIcon = icon(H.Alert02Icon);
export const Type = icon(H.TextIcon);
export const Undo2 = icon(H.Undo02Icon);
export const X = icon(H.Cancel01Icon);
export const XIcon = icon(H.Cancel01Icon);
export const ZoomIn = icon(H.ZoomInAreaIcon);
export const ZoomOut = icon(H.ZoomOutAreaIcon);
