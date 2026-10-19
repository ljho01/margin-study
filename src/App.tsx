import { useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "next-themes";
import {
  formatForDisplay,
  useHotkeys,
  type UseHotkeyDefinition,
} from "@tanstack/react-hotkeys";
import {
  ArrowDownToLine,
  BookOpen,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileText,
  FolderOpen,
  Loader2,
  LogOut,
  Monitor,
  Moon,
  PanelBottom,
  PanelLeft,
  PanelRight,
  Save,
  Settings2,
  Sun,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarInset,
  SidebarProvider,
} from "@/components/ui/sidebar";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Toaster } from "@/components/ui/sonner";
import AnnotationLayer from "@/components/AnnotationLayer";
import StablePage from "@/components/StablePage";
import ChatPanel from "@/components/ChatPanel";
import { type ComposerHandle } from "@/components/ChatComposer";
import ColorPicker from "@/components/ColorPicker";
import SelectionBubble from "@/components/SelectionBubble";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { IconButton } from "@/components/IconButton";
import OcrLayer from "@/components/OcrLayer";
import PageThumbnailList from "@/components/PageThumbnailList";
import AnalysisPanel from "@/components/AnalysisPanel";
import WorkspaceTree from "@/components/WorkspaceTree";
import { useStudy } from "@/hooks/use-study";
import { MAX_ZOOM, MIN_ZOOM, usePinchZoom } from "@/hooks/use-pinch-zoom";
import { COLORS, TOOL_ITEMS, isInkTool, type InkTool } from "@/lib/viewer";
import type { Tool } from "@/lib/types";
import * as ai from "@/lib/ai";
import { restartApp, startAutoUpdate } from "@/lib/updater";
import { toast } from "sonner";

const KEYS = {
  save: "Mod+S",
  undo: "Mod+Z",
  redo: "Mod+Shift+Z",
  open: "Mod+O",
  folder: "Mod+Shift+O",
  left: "Mod+B",
  right: "Mod+Shift+B",
  newChat: "Mod+Alt+S",
  bottom: "Mod+J",
  ask: "/",
  files: "Alt+1",
  pages: "Alt+2",
  highlight: "H",
  delete: "Delete",
} as const;
const shortcut = (hotkey: string) => formatForDisplay(hotkey);

/** Arrow and delete keys belong to menus, dialogs, and composite widgets while they have focus. */
const pageKeysBlocked = (event: KeyboardEvent) =>
  !!document.querySelector(
    '[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"]',
  ) ||
  !!(event.target as HTMLElement | null)?.closest?.(
    '[role="tablist"],[role="toolbar"],[role="radiogroup"],[role="group"],[role="separator"],[role="tree"]',
  );

export default function App() {
  const s = useStudy();
  const {
    doc,
    pdf,
    workspace,
    pageIndex,
    analysis,
    annotations,
    processing,
    busy,
  } = s;
  const { theme = "system", setTheme } = useTheme();
  const ocrLines = doc?.ocr?.[doc.currentPage];
  const [selectedMark, setSelectedMark] = useState<string | null>(null);
  // Side panels keep their pixel width across toggles and launches.
  const savedWidth = (key: string, fallback: number) =>
    Number(localStorage.getItem(key)) || fallback;
  // Panels re-register (and reset their layout) whenever defaultSize changes,
  // so the saved width is read only when a panel mounts. Switching between
  // documents keeps the chat panel mounted and must not reset it.
  const sidebarSize = useMemo(
    () => savedWidth("margin-sidebar-width", 260),
    [s.leftOpen],
  );
  const reading = !!(doc && pdf);
  const chatSize = useMemo(
    () => savedWidth("margin-chat-width", 360),
    [s.rightOpen, reading],
  );
  const keepWidth =
    (key: string) =>
    ({ inPixels }: { inPixels: number }) => {
      if (inPixels > 0) localStorage.setItem(key, String(Math.round(inPixels)));
    };
  usePinchZoom({
    region: s.canvasRegion,
    surface: s.pageSurface,
    zoom: s.zoom,
    setZoom: s.setZoom,
  });
  const chatInput = useRef<ComposerHandle>(null);
  const focusChat = useRef(false);
  useEffect(() => {
    if (!s.rightOpen || !focusChat.current) return;
    focusChat.current = false;
    chatInput.current?.focus();
  }, [s.rightOpen, doc?.id, doc?.activeChat]);
  // Opens the chat panel on a fresh session with the input focused.
  const startChat = () => {
    if (!doc) return;
    s.newChat();
    focusChat.current = true;
    s.setRightOpen(true);
    requestAnimationFrame(() => chatInput.current?.focus());
  };
  // Cmd+W belongs to the chat panel after the last click or focus landed in it.
  const inChat = useRef(false);
  useEffect(() => {
    const track = (event: Event) => {
      inChat.current = !!(event.target as Element | null)?.closest?.(
        "[data-chat-panel]",
      );
    };
    document.addEventListener("pointerdown", track, true);
    document.addEventListener("focusin", track, true);
    return () => {
      document.removeEventListener("pointerdown", track, true);
      document.removeEventListener("focusin", track, true);
    };
  }, []);
  /** Closes the chat tab while working in the chat panel; otherwise minimizes the window. */
  const closeOrMinimize = () => {
    const id = doc?.activeChat;
    if (doc && id && s.rightOpen && inChat.current) {
      const empty = !doc.sessions?.find((x) => x.id === id)?.messages.length;
      if ((doc.openChats?.length ?? 0) <= 1 && empty) {
        // Only a blank chat is left, so close the panel itself; the next
        // Cmd+W then minimizes the window.
        inChat.current = false;
        (document.activeElement as HTMLElement | null)?.blur();
        s.setRightOpen(false);
        return;
      }
      if (s.streamingChats.includes(id)) s.stopChat(id, false);
      s.closeChat(id);
      requestAnimationFrame(() => chatInput.current?.focus());
      return;
    }
    void ai.minimizeWindow().catch(s.workspaceError);
  };
  const closeShortcut = useRef(closeOrMinimize);
  closeShortcut.current = closeOrMinimize;
  useEffect(() => {
    let dispose: (() => void) | undefined;
    let closed = false;
    void ai
      .onCloseShortcut(() => closeShortcut.current())
      .then((unlisten) => {
        if (closed) unlisten();
        else dispose = unlisten;
      });
    return () => {
      closed = true;
      dispose?.();
    };
  }, []);
  // Opening the chat panel focuses its input so a question can be typed at once.
  const toggleChat = () => {
    if (s.rightOpen) return s.setRightOpen(false);
    focusChat.current = true;
    s.setRightOpen(true);
  };
  /** Opens the chat panel if needed and puts the cursor in its input. */
  const askChat = () => {
    if (!s.rightOpen) {
      focusChat.current = true;
      s.setRightOpen(true);
    }
    requestAnimationFrame(() => chatInput.current?.focus());
  };
  useEffect(() => setSelectedMark(null), [doc?.id, doc?.currentPage]);
  const deleteSelection = () => {
    if (selectedMark && annotations.some((a) => a.id === selectedMark)) {
      s.changeAnnotations(annotations.filter((a) => a.id !== selectedMark));
      setSelectedMark(null);
    } else s.deletePages();
  };

  useEffect(() => {
    document.title = doc ? (doc.dirty ? "● " : "") + doc.name : "여백";
  }, [doc?.name, doc?.dirty]);

  // A new release installs in the background; the restart stays the user's call.
  useEffect(
    () =>
      startAutoUpdate((version) =>
        toast(`새 버전 ${version}이 설치됐어요`, {
          description: "다시 시작하면 적용돼요.",
          duration: Infinity,
          action: {
            label: "다시 시작",
            onClick: () => void restartApp().catch((error) => {
              toast.error("다시 시작하지 못했어요", { description: String(error) });
            }),
          },
        }),
      ),
    [],
  );

  const openSingle = () => {
    s.setActivePath(null);
    void s.importFile();
  };
  const selectTool = (tool: Tool) => {
    setSelectedMark(null);
    s.setTool(tool);
  };
  /** A color picked for a tool also recolors the selected mark of that kind. */
  const recolor = (tool: InkTool, color: string) => {
    const mark = annotations.find((a) => a.id === selectedMark);
    if (mark && mark.type === tool && mark.color !== color)
      s.changeAnnotations(
        annotations.map((a) => (a.id === mark.id ? { ...a, color } : a)),
      );
  };
  const pageKey =
    (callback: () => void): UseHotkeyDefinition["callback"] =>
    (event) => {
      if (doc && !pageKeysBlocked(event)) callback();
    };
  useHotkeys([
    { hotkey: KEYS.save, callback: () => void s.saveDocument() },
    {
      hotkey: KEYS.undo,
      callback: () => s.undo(),
      options: { ignoreInputs: true },
    },
    {
      hotkey: KEYS.redo,
      callback: () => s.redo(),
      options: { ignoreInputs: true },
    },
    { hotkey: KEYS.open, callback: openSingle },
    { hotkey: KEYS.folder, callback: () => void s.chooseFolder() },
    { hotkey: KEYS.left, callback: () => s.setLeftOpen((open) => !open) },
    {
      hotkey: KEYS.right,
      callback: toggleChat,
      options: { ignoreInputs: false },
    },
    {
      // Typing "/" in a text field stays text; elsewhere it jumps to the chat.
      hotkey: KEYS.ask,
      callback: pageKey(askChat),
      options: { preventDefault: true },
    },
    {
      hotkey: KEYS.newChat,
      callback: startChat,
      options: { ignoreInputs: false },
    },
    { hotkey: KEYS.bottom, callback: () => s.setBottomOpen((open) => !open) },
    {
      hotkey: KEYS.files,
      callback: () => {
        s.setLeftOpen(true);
        s.setSidebarTab("files");
      },
    },
    {
      hotkey: KEYS.pages,
      callback: () => {
        s.setLeftOpen(true);
        s.setSidebarTab("pages");
      },
    },
    { hotkey: "ArrowUp", callback: pageKey(() => s.navigate(-1)) },
    { hotkey: "ArrowLeft", callback: pageKey(() => s.navigate(-1)) },
    { hotkey: "ArrowDown", callback: pageKey(() => s.navigate(1)) },
    { hotkey: "ArrowRight", callback: pageKey(() => s.navigate(1)) },
    { hotkey: "Delete", callback: pageKey(deleteSelection) },
    { hotkey: "Backspace", callback: pageKey(deleteSelection) },
    {
      hotkey: "Escape",
      callback: pageKey(() => {
        setSelectedMark(null);
        s.setSelected([]);
      }),
    },
    ...TOOL_ITEMS.map((item) => ({
      hotkey: item.shortcut,
      callback: () => {
        if (item.id === "highlight" && s.highlightSelection()) return;
        selectTool(item.id);
      },
    })),
  ]);

  const topBar = (
    <header
      className={
        "flex h-11 shrink-0 items-center gap-2 border-b px-3 " +
        // Leaves room for the fixed sidebar toggle when the sidebar is closed.
        (s.leftOpen ? "" : ai.desktop ? "pl-30" : "pl-12")
      }
      data-tauri-drag-region
    >
      <Button
        variant="ghost"
        size="sm"
        className="min-w-0 shrink justify-start"
        onClick={() => {
          void s.refreshLibrary();
          s.setLibraryOpen(true);
        }}
      >
        <FileText />
        <span className="truncate">{doc?.name ?? "여백"}</span>
        {doc?.dirty && (
          <span
            aria-label="수정됨"
            className="size-2 shrink-0 rounded-full bg-foreground"
          />
        )}
      </Button>
      <div className="h-full min-w-4 flex-1" data-tauri-drag-region />
      <div className="flex shrink-0 items-center gap-1">
        <IconButton
          label="폴더 열기"
          hotkey={KEYS.folder}
          disabled={!ai.desktop || busy}
          onClick={() => void s.chooseFolder()}
        >
          <FolderOpen />
        </IconButton>
        <IconButton
          label="PDF 열기"
          hotkey={KEYS.open}
          disabled={busy}
          onClick={openSingle}
        >
          <BookOpen />
        </IconButton>
        {doc && (
          <>
            <IconButton
              label="저장"
              hotkey={KEYS.save}
              disabled={s.saving || busy || (!doc.dirty && !!doc.source)}
              onClick={() => void s.saveDocument()}
            >
              {s.saving ? <Loader2 className="animate-spin" /> : <Save />}
            </IconButton>
            <IconButton
              label="사본 내보내기"
              disabled={s.exporting}
              onClick={() => void s.exportFile()}
            >
              {s.exporting ? (
                <Loader2 className="animate-spin" />
              ) : (
                <ArrowDownToLine />
              )}
            </IconButton>
          </>
        )}
        <Separator orientation="vertical" className="mx-1 h-5" />
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button size="icon-sm" variant="ghost" aria-label="테마">
                  <Sun className="dark:hidden" />
                  <Moon className="hidden dark:block" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>테마</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end">
            <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
              <DropdownMenuRadioItem value="light">
                <Sun />
                라이트
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="dark">
                <Moon />
                다크
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="system">
                <Monitor />
                시스템
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <IconButton
          label="AI 구독 설정"
          onClick={() => s.setSettingsOpen(true)}
        >
          <Settings2 />
        </IconButton>
        <IconButton
          label="해설 패널"
          hotkey={KEYS.bottom}
          aria-pressed={s.bottomOpen}
          onClick={() => s.setBottomOpen(!s.bottomOpen)}
        >
          <PanelBottom />
        </IconButton>
        {!(doc && pdf && s.rightOpen) && (
          <IconButton
            label="질문 패널"
            hotkey={KEYS.right}
            onClick={toggleChat}
          >
            <PanelRight />
          </IconButton>
        )}
      </div>
    </header>
  );

  return (
    <TooltipProvider>
      <div
        className="relative flex h-svh flex-col overflow-hidden bg-background"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const file = e.dataTransfer.files[0];
          if (file) {
            s.setActivePath(null);
            void file
              .arrayBuffer()
              .then((bytes) => s.openBytes(bytes, file.name));
          }
        }}
      >
        <input
          hidden
          type="file"
          ref={s.inputRef}
          accept="application/pdf,.pdf"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              s.setActivePath(null);
              void file
                .arrayBuffer()
                .then((bytes) => s.openBytes(bytes, file.name));
            }
            e.target.value = "";
          }}
        />
        <SidebarProvider
          open={s.leftOpen}
          onOpenChange={s.setLeftOpen}
          className="min-h-0 flex-1 overflow-hidden"
        >
          <ResizablePanelGroup
            orientation="horizontal"
            className="min-h-0 flex-1"
          >
            {s.leftOpen && (
              <>
                <ResizablePanel
                  id="sidebar"
                  defaultSize={sidebarSize}
                  onResize={keepWidth("margin-sidebar-width")}
                  minSize={200}
                  maxSize={520}
                  groupResizeBehavior="preserve-pixel-size"
                >
                  <Sidebar collapsible="none" className="w-full">
                    {/* The folder menu sits in the title bar, right of the
                        pinned sidebar toggle. It shrinks to fit its name,
                        truncates past the sidebar width, and below 6rem of
                        room shows only the folder icon and chevron. */}
                    <div
                      className={
                        "flex h-11 shrink-0 items-center gap-1 pr-2 " +
                        (ai.desktop ? "pl-[7.25rem]" : "pl-11")
                      }
                      data-tauri-drag-region
                    >
                      <div
                        className="@container flex h-full min-w-0 flex-1 items-center"
                        data-tauri-drag-region
                      >
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="max-w-full min-w-0 justify-start gap-1.5 px-2"
                            disabled={busy}
                            title={workspace?.name ?? "폴더 열기"}
                            aria-label={workspace?.name ?? "폴더 열기"}
                          >
                            <FolderOpen />
                            <span className="hidden truncate @[6rem]:inline">
                              {workspace?.name ?? "폴더 열기"}
                            </span>
                            <ChevronDown className="text-muted-foreground" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="w-64">
                          {s.workspaces.map((root) => (
                            <DropdownMenuItem
                              key={root.id}
                              onSelect={() => void s.activateWorkspace(root)}
                            >
                              <FolderOpen />
                              <span className="truncate" title={root.path}>
                                {root.name}
                              </span>
                            </DropdownMenuItem>
                          ))}
                          {!!s.workspaces.length && <DropdownMenuSeparator />}
                          <DropdownMenuItem
                            disabled={!ai.desktop}
                            onSelect={() => void s.chooseFolder()}
                          >
                            <FolderOpen />
                            폴더 열기
                            <DropdownMenuShortcut>
                              {shortcut(KEYS.folder)}
                            </DropdownMenuShortcut>
                          </DropdownMenuItem>
                          {workspace && (
                            <DropdownMenuItem onSelect={s.closeFolder}>
                              폴더 닫기
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                      </div>
                    </div>
                    <Tabs
                      value={s.sidebarTab}
                      onValueChange={s.setSidebarTab}
                      className="flex min-h-0 flex-1 flex-col gap-0"
                    >
                      {/* Same 48px row, 32px control height, and 1px bottom
                          border (transparent here) as the tool bar beside it,
                          so both center on the same 47px and their top and
                          bottom edges line up to the device pixel. */}
                      <div className="flex h-12 shrink-0 items-center border-b border-transparent px-2">
                        <TabsList className="grid w-full grid-cols-2 group-data-[orientation=horizontal]/tabs:h-8">
                          {/* py-0: the 32px list leaves 25px per trigger; the
                              default py-1 needs 30px and stuck out below. */}
                          <TabsTrigger value="files" className="py-0">
                            파일
                          </TabsTrigger>
                          <TabsTrigger value="pages" className="py-0">
                            페이지
                          </TabsTrigger>
                        </TabsList>
                      </div>
                      <SidebarContent className="overflow-hidden">
                        <TabsContent
                          value="files"
                          className="mt-0 min-h-0 flex-1"
                        >
                          <ScrollArea className="h-full [&_[data-slot=scroll-area-viewport]>div]:!block">
                            {workspace ? (
                              <WorkspaceTree
                                workspace={workspace}
                                activePath={s.activePath}
                                disabled={busy}
                                onOpen={(entry) =>
                                  void s.openWorkspaceFile(entry)
                                }
                                onError={s.workspaceError}
                                onRelocate={s.relocateWorkspaceEntry}
                              />
                            ) : (
                              <div className="p-2">
                                <Button
                                  variant="outline"
                                  className="w-full"
                                  disabled={!ai.desktop}
                                  onClick={() => void s.chooseFolder()}
                                >
                                  <FolderOpen />
                                  폴더 열기
                                </Button>
                              </div>
                            )}
                          </ScrollArea>
                        </TabsContent>
                        <TabsContent
                          value="pages"
                          className="mt-0 min-h-0 flex-1"
                        >
                          <div className="flex h-full min-h-0 flex-col">
                            {doc && pdf && (
                              <>
                                <div className="space-y-2 px-2 pb-2">
                                  <form
                                    onSubmit={(e) => {
                                      e.preventDefault();
                                      void s.runSearch();
                                    }}
                                  >
                                    <Input
                                      aria-label="문서 검색"
                                      placeholder="검색"
                                      value={s.search}
                                      onChange={(e) => {
                                        s.setSearch(e.target.value);
                                        if (!e.target.value)
                                          s.setSearchResults(null);
                                      }}
                                    />
                                  </form>
                                </div>
                                <PageThumbnailList
                                  key={s.viewKey ?? doc.id}
                                  memoryKey={doc.id}
                                  pdf={pdf}
                                  pages={s.searchResults ?? doc.pages}
                                  order={doc.pages}
                                  current={doc.currentPage}
                                  selected={s.selected}
                                  annotations={doc.annotations}
                                  onPick={(page, event) => {
                                    // Cmd-click toggles and Shift-click
                                    // extends a selection, as in Preview;
                                    // Delete removes the selected pages.
                                    const list = s.searchResults ?? doc.pages;
                                    if (event.metaKey) {
                                      s.setSelected((values) => {
                                        const base = values.length
                                          ? values
                                          : [doc.currentPage];
                                        return base.includes(page)
                                          ? base.filter((v) => v !== page)
                                          : [...base, page];
                                      });
                                    } else if (
                                      event.shiftKey &&
                                      list.includes(doc.currentPage)
                                    ) {
                                      const a = list.indexOf(doc.currentPage);
                                      const b = list.indexOf(page);
                                      s.setSelected(
                                        list.slice(
                                          Math.min(a, b),
                                          Math.max(a, b) + 1,
                                        ),
                                      );
                                    } else {
                                      s.setSelected([]);
                                      s.goTo(page);
                                    }
                                  }}
                                />
                              </>
                            )}
                          </div>
                        </TabsContent>
                      </SidebarContent>
                    </Tabs>
                  </Sidebar>
                </ResizablePanel>
                <ResizableHandle />
              </>
            )}
            <ResizablePanel id="main" minSize={560} className="flex min-h-0">
              <SidebarInset className="min-h-0 min-w-0 overflow-hidden">
                {doc && pdf ? (
                  <ResizablePanelGroup
                    orientation="horizontal"
                    className="min-h-0 flex-1"
                  >
                    <ResizablePanel
                      id="reader"
                      defaultSize="76%"
                      minSize={320}
                      className="flex min-h-0 flex-col"
                    >
                      {topBar}
                      <div className="flex h-12 shrink-0 items-center gap-2 overflow-x-auto border-b px-2">
                        <ToggleGroup
                          type="single"
                          size="sm"
                          value={s.tool}
                          onValueChange={(value) =>
                            value && selectTool(value as Tool)
                          }
                          aria-label="필기 도구"
                        >
                          {TOOL_ITEMS.map((item) => {
                            const ink = isInkTool(item.id) ? item.id : null;
                            return (
                              <div key={item.id} className="flex items-center">
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <ToggleGroupItem
                                      value={item.id}
                                      aria-label={item.label}
                                      className={
                                        "relative text-muted-foreground hover:bg-accent hover:text-foreground aria-checked:bg-accent aria-checked:text-foreground" +
                                        (ink ? " rounded-r-none" : "")
                                      }
                                    >
                                      <item.icon className="size-4" />
                                      {ink && (
                                        <span
                                          className="absolute bottom-1 left-1/2 h-0.5 w-3 -translate-x-1/2 rounded-full"
                                          style={{
                                            backgroundColor: s.colors[ink],
                                          }}
                                        />
                                      )}
                                    </ToggleGroupItem>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    {item.id === "highlight"
                                      ? "하이라이트 · 텍스트 선택 후 누르기"
                                      : item.label}
                                    <span className="ml-2 text-muted-foreground">
                                      {item.shortcut}
                                    </span>
                                  </TooltipContent>
                                </Tooltip>
                                {ink && (
                                  <Popover>
                                    <PopoverTrigger asChild>
                                      <Button
                                        variant="ghost"
                                        aria-label={item.label + " 색상"}
                                        className="h-8 w-4 rounded-l-none px-0 text-muted-foreground hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground"
                                      >
                                        <ChevronDown className="size-3" />
                                      </Button>
                                    </PopoverTrigger>
                                    <PopoverContent align="start" className="w-auto p-3">
                                      <ColorPicker
                                        value={s.colors[ink]}
                                        presets={COLORS}
                                        onChange={(color) =>
                                          s.setToolColor(ink, color)
                                        }
                                        onCommit={(color) => recolor(ink, color)}
                                      />
                                    </PopoverContent>
                                  </Popover>
                                )}
                              </div>
                            );
                          })}
                        </ToggleGroup>
                        <IconButton
                          label="되돌리기"
                          hotkey={KEYS.undo}
                          disabled={!s.history.length || s.saving || s.restoring || busy}
                          onClick={s.undo}
                        >
                          <Undo2 />
                        </IconButton>
                        <Separator orientation="vertical" className="h-5" />
                        <div className="ml-auto flex shrink-0 items-center gap-1">
                          <IconButton
                            label="이전 페이지"
                            hotkey="ArrowUp"
                            disabled={pageIndex === 0}
                            onClick={() => s.navigate(-1)}
                          >
                            <ChevronLeft />
                          </IconButton>
                          <Input
                            aria-label="페이지 번호"
                            inputMode="numeric"
                            className="h-8 w-12 px-1 text-center tabular-nums"
                            value={pageIndex + 1}
                            onChange={(e) => {
                              const page =
                                doc.pages[Number(e.target.value) - 1];
                              if (page) s.goTo(page);
                            }}
                          />
                          <span className="px-1 text-xs text-muted-foreground tabular-nums">
                            / {doc.pages.length}
                          </span>
                          <IconButton
                            label="다음 페이지"
                            hotkey="ArrowDown"
                            disabled={pageIndex === doc.pages.length - 1}
                            onClick={() => s.navigate(1)}
                          >
                            <ChevronRight />
                          </IconButton>
                        </div>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="tabular-nums"
                            >
                              {Math.round(s.zoom * 100)}%
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onSelect={() =>
                                s.setZoom((value) =>
                                  Math.min(MAX_ZOOM, value + 0.1),
                                )
                              }
                            >
                              <ZoomIn />
                              확대
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() =>
                                s.setZoom((value) =>
                                  Math.max(MIN_ZOOM, value - 0.1),
                                )
                              }
                            >
                              <ZoomOut />
                              축소
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onSelect={() => s.setZoom(1)}>
                              화면 맞춤
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                      <ResizablePanelGroup
                        orientation="vertical"
                        className="min-h-0 flex-1"
                      >
                        <ResizablePanel
                          id="pdf"
                          defaultSize="68%"
                          minSize={120}
                        >
                          <SelectionBubble
                            surface={s.pageSurface}
                            region={s.canvasRegion}
                            colors={COLORS.slice(0, 5)}
                            current={s.colors.highlight}
                            onHighlight={(color) => {
                              s.setToolColor("highlight", color);
                              s.highlightSelection(color);
                            }}
                            onAttach={() => {
                              if (s.attachSelection()) askChat();
                            }}
                          />
                          <div
                            ref={s.canvasRegion}
                            className="h-full overflow-auto bg-muted"
                            onPointerDown={() => setSelectedMark(null)}
                          >
                            <div
                              className="flex min-h-full justify-center p-4"
                              style={{ minWidth: s.pageWidth + 32 }}
                            >
                              <div
                                ref={s.pageSurface}
                                inert={s.saving || s.restoring}
                                className="relative h-fit shrink-0 border bg-white shadow-sm"
                                style={{
                                  width: s.pageWidth,
                                  minHeight: s.pageHeight,
                                }}
                              >
                                <StablePage
                                  pdf={pdf}
                                  onDisplayed={s.pageDisplayed}
                                  suspense={false}
                                  page={doc.currentPage}
                                  width={s.pageWidth}
                                  height={s.pageHeight}
                                  renderAnnotationLayer={false}
                                  onRenderError={() =>
                                    toast.error(
                                      "페이지를 다시 그리지 못해 이전 화면을 유지하고 있어요.",
                                    )
                                  }
                                  onGetTextSuccess={({ items }) => {
                                    if (
                                      !items.some(
                                        (item) =>
                                          "str" in item && item.str.trim(),
                                      )
                                    )
                                      void s.ensureOcr(doc.currentPage);
                                  }}
                                  loading={
                                    <div
                                      className="flex items-center justify-center"
                                      style={{ height: s.pageHeight }}
                                    >
                                      <Loader2 className="size-4 animate-spin text-muted-foreground" />
                                    </div>
                                  }
                                  overlay={
                                    <>
                                      {ocrLines && (
                                        <OcrLayer
                                          lines={ocrLines}
                                          width={s.pageWidth}
                                          height={s.pageHeight}
                                        />
                                      )}
                                      <AnnotationLayer
                                        key={
                                          doc.id +
                                          ":" +
                                          doc.currentPage +
                                          ":" +
                                          s.tool
                                        }
                                        annotations={annotations}
                                        onChange={s.changeAnnotations}
                                        tool={s.tool}
                                        color={isInkTool(s.tool) ? s.colors[s.tool] : s.colors.pen}
                                        width={s.pageWidth}
                                        height={s.pageHeight}
                                        selected={selectedMark}
                                        onSelect={setSelectedMark}
                                        onTextDone={(id) => {
                                          // As in Figma: after typing, the
                                          // new text is selected with the
                                          // select tool, ready to move;
                                          // double-click edits it again.
                                          s.setTool("select");
                                          setSelectedMark(id);
                                        }}
                                      />
                                    </>
                                  }
                                />
                              </div>
                            </div>
                          </div>
                        </ResizablePanel>
                        {s.bottomOpen && (
                          <>
                            <ResizableHandle />
                            <ResizablePanel
                              id="analysis"
                              defaultSize="32%"
                              minSize={100}
                            >
                              <AnalysisPanel s={s} />
                            </ResizablePanel>
                          </>
                        )}
                      </ResizablePanelGroup>
                    </ResizablePanel>
                    {s.rightOpen && (
                      <>
                        <ResizableHandle />
                        <ResizablePanel
                          id="chat"
                          defaultSize={chatSize}
                          onResize={keepWidth("margin-chat-width")}
                          minSize={240}
                          groupResizeBehavior="preserve-pixel-size"
                        >
                          <ChatPanel
                            s={s}
                            input={chatInput}
                            newChatHotkey={KEYS.newChat}
                          />
                        </ResizablePanel>
                      </>
                    )}
                  </ResizablePanelGroup>
                ) : (
                  <div className="flex min-h-0 flex-1 flex-col">
                    {topBar}
                    <div className="flex flex-1 items-center justify-center gap-2">
                      <Button
                        onClick={() => void s.chooseFolder()}
                        disabled={!ai.desktop}
                      >
                        <FolderOpen />
                        폴더 열기
                      </Button>
                      <Button variant="outline" onClick={openSingle}>
                        <FileText />
                        PDF 열기
                      </Button>
                    </div>
                  </div>
                )}
              </SidebarInset>
            </ResizablePanel>
          </ResizablePanelGroup>
        </SidebarProvider>
        {/* One toggle for both states, pinned beside the traffic lights like Non. */}
        <div
          className={
            "absolute top-1.5 z-50 flex items-center " +
            (ai.desktop ? "left-20" : "left-2")
          }
        >
          <IconButton
            label="탐색기"
            hotkey={KEYS.left}
            aria-expanded={s.leftOpen}
            onClick={() => s.setLeftOpen((open) => !open)}
          >
            <PanelLeft />
          </IconButton>
        </div>

        <AlertDialog
          open={!!s.pendingFolder}
          onOpenChange={(open) => {
            if (!open) s.setPendingFolder(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>이 폴더를 신뢰하시겠습니까?</AlertDialogTitle>
              <AlertDialogDescription>
                선택한 폴더와 하위 폴더의 PDF를 읽고 저장합니다.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <p className="rounded-md bg-muted p-3 text-sm break-all">
              {s.pendingFolder}
            </p>
            <AlertDialogFooter>
              <AlertDialogCancel>취소</AlertDialogCancel>
              <AlertDialogAction onClick={() => void s.confirmFolder()}>
                신뢰하고 열기
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <Dialog
          open={s.settingsOpen}
          onOpenChange={(open) => {
            s.setSettingsOpen(open);
            if (!open && s.authBusy) s.cancelAuth();
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>AI 구독 설정</DialogTitle>
              <DialogDescription className="sr-only">
                계정 및 모델 설정
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-6">
              {!ai.desktop ? (
                <p className="text-sm text-muted-foreground">
                  데스크톱 앱에서 연결할 수 있습니다.
                </p>
              ) : (
                <>
                  <div className="space-y-4">
                    {(["chatgpt", "claude"] as const).map((provider) => {
                      const account =
                        provider === "claude" ? s.claudeAccount : s.account;
                      const name = provider === "claude" ? "Claude" : "ChatGPT";
                      const waiting =
                        s.loginId &&
                        s.loginId.startsWith("claude:") ===
                          (provider === "claude");
                      return (
                        <div
                          key={provider}
                          className="rounded-lg border p-3 space-y-2"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-medium">{name} 구독</p>
                              <p className="truncate text-xs text-muted-foreground">
                                {account
                                  ? provider === "claude"
                                    ? "연결됨"
                                    : account.email
                                  : "구독 계정으로 로그인하세요"}
                              </p>
                            </div>
                            {account ? (
                              <IconButton
                                label={`${name} 연결 해제`}
                                disabled={s.authBusy || busy}
                                onClick={() =>
                                  void s.authAction("logout", provider)
                                }
                              >
                                <LogOut />
                              </IconButton>
                            ) : (
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={s.authBusy}
                                onClick={() =>
                                  void s.authAction("login", provider)
                                }
                              >
                                {waiting && (
                                  <Loader2 className="animate-spin" />
                                )}
                                {name} 로그인
                              </Button>
                            )}
                          </div>
                          {!account && provider === "chatgpt" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={s.authBusy}
                              onClick={() => void s.authAction("existing")}
                            >
                              기존 로그인 연결
                            </Button>
                          )}
                          {waiting && (
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs text-muted-foreground">
                                브라우저에서 로그인을 완료해 주세요.
                              </span>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={s.cancelAuth}
                              >
                                취소
                              </Button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {s.modelList.length > 0 && (
                    <div className="space-y-2">
                      <Label htmlFor="model">모델</Label>
                      <Select
                        value={s.model}
                        onValueChange={s.setModel}
                        disabled={busy}
                      >
                        <SelectTrigger id="model" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {s.modelList.map((model) => (
                            <SelectItem key={model.id} value={model.model}>
                              {model.displayName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </>
              )}
              <div className="flex items-center gap-2">
                <Checkbox
                  id="translation"
                  checked={s.translate}
                  disabled={!!processing}
                  onCheckedChange={(value) => s.setTranslate(value === true)}
                />
                <Label htmlFor="translation">자동 번역</Label>
              </div>
              {s.authError && (
                <p className="text-sm text-destructive" role="alert">
                  {s.authError}
                </p>
              )}
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={s.libraryOpen} onOpenChange={s.setLibraryOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>최근 문서</DialogTitle>
              <DialogDescription className="sr-only">
                저장된 PDF
              </DialogDescription>
            </DialogHeader>
            <ScrollArea className="max-h-96">
              <div className="space-y-1">
                {s.library.map((item) => (
                  <Button
                    key={item.id}
                    variant="ghost"
                    className="w-full justify-start"
                    disabled={busy}
                    onClick={() => {
                      s.setActivePath(null);
                      void s.openStored(item.id);
                    }}
                  >
                    <FileText />
                    <span className="truncate">{item.name}</span>
                  </Button>
                ))}
              </div>
            </ScrollArea>
          </DialogContent>
        </Dialog>
        <Toaster />
      </div>
    </TooltipProvider>
  );
}
