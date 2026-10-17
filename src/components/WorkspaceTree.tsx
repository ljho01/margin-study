import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { DragDropProvider, DragOverlay, useDraggable, useDroppable } from "@dnd-kit/react";
import { PointerActivationConstraints, PointerSensor } from "@dnd-kit/dom";
import { isTauri } from "@tauri-apps/api/core";
import {
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  Loader2,
  RefreshCw,
} from "@/components/icons";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuSub,
  SidebarGroup,
  SidebarGroupContent,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  listDirectory,
  moveEntry,
  renameEntry,
  revealEntry,
  trashEntry,
  type Workspace,
  type WorkspaceEntry,
} from "@/lib/workspace";

// Matches Non: muted rows, accent background on hover and for the open file.
// select-none: a right-click must not select the row name, as in Finder.
const ROW =
  "select-none rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground active:bg-accent active:text-foreground data-[active=true]:bg-accent data-[active=true]:font-normal data-[active=true]:text-foreground data-[state=open]:hover:bg-accent data-[state=open]:hover:text-foreground [&_svg]:text-muted-foreground";
/** Finder outlines the row a context menu belongs to, and a folder under a drag. */
const OUTLINED = "ring-1 ring-inset ring-blue-500";
const DROP = "bg-blue-500/15 text-foreground ring-1 ring-inset ring-blue-500";

const Pointer = PointerSensor.configure({
  activationConstraints: [
    new PointerActivationConstraints.Distance({ value: 5 }),
  ],
});
const parentOf = (path: string) =>
  path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
const within = (path: string, folder: string) =>
  path === folder || path.startsWith(folder + "/");

type Props = {
  workspace: Workspace;
  activePath: string | null;
  disabled: boolean;
  onOpen: (entry: WorkspaceEntry) => void;
  onError: (error: unknown) => void;
  /** A file or folder moved (`to`) or went to the Trash (`null`). */
  onRelocate: (from: string, to: string | null) => void;
};
type Actions = {
  renaming: string | null;
  menuFor: string | null;
  dragging: WorkspaceEntry | null;
  rename: (entry: WorkspaceEntry, name: string | null) => void;
  menu: (entry: WorkspaceEntry, event: MouseEvent) => void;
};
const TreeActions = createContext<Actions | null>(null);
const useActions = () => useContext(TreeActions)!;

export default function WorkspaceTree(props: Props) {
  const [revision, setRevision] = useState(0);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [dragging, setDragging] = useState<WorkspaceEntry | null>(null);
  const id = props.workspace.id;
  const expandedKey = `margin-expanded:${id}`;
  /** Keeps expanded folders, the open file and the list in step with a change. */
  const relocate = (from: string, to: string | null) => {
    try {
      const paths: string[] = JSON.parse(
        localStorage.getItem(expandedKey) ?? "[]",
      );
      localStorage.setItem(
        expandedKey,
        JSON.stringify(
          paths.flatMap((path) =>
            !within(path, from)
              ? [path]
              : to === null
                ? []
                : [to + path.slice(from.length)],
          ),
        ),
      );
    } catch {}
    props.onRelocate(from, to);
    setRevision((n) => n + 1);
  };
  const run = async (task: () => Promise<void>) => {
    try {
      await task();
    } catch (error) {
      props.onError(error);
      setRevision((n) => n + 1);
    }
  };
  const actions: Actions = {
    renaming,
    menuFor,
    dragging,
    rename: (entry, name) => {
      setRenaming(null);
      const next = name?.trim();
      if (!next || next === entry.name) return;
      void run(async () =>
        relocate(entry.path, await renameEntry(id, entry.path, next)),
      );
    },
    menu: (entry, event) => {
      event.preventDefault();
      if (!isTauri() || props.disabled || renaming) return;
      setMenuFor(entry.path);
      void (async () => {
        const { Menu } = await import("@tauri-apps/api/menu");
        const menu = await Menu.new({
          items: [
            {
              id: "reveal",
              text: "Finder에서 보기",
              action: () => void run(() => revealEntry(id, entry.path)),
            },
            { item: "Separator" },
            {
              id: "rename",
              text: "이름 변경",
              action: () => setRenaming(entry.path),
            },
            { item: "Separator" },
            {
              id: "trash",
              text: "휴지통으로 이동",
              action: () =>
                void run(async () => {
                  await trashEntry(id, entry.path);
                  relocate(entry.path, null);
                }),
            },
          ],
        });
        await menu.popup();
      })()
        .catch(props.onError)
        .finally(() => setMenuFor(null));
    },
  };
  const move = (entry: WorkspaceEntry, directory: string) => {
    if (parentOf(entry.path) === directory) return;
    if (entry.isDirectory && within(directory, entry.path)) return;
    void run(async () =>
      relocate(entry.path, await moveEntry(id, entry.path, directory)),
    );
  };
  return (
    <TreeActions.Provider value={actions}>
      <DragDropProvider
        sensors={[Pointer]}
        onDragStart={(event) =>
          setDragging(
            (event.operation.source?.data as WorkspaceEntry | undefined) ??
              null,
          )
        }
        onDragEnd={(event) => {
          setDragging(null);
          if (event.canceled) return;
          const { source, target } = event.operation;
          const entry = source?.data as WorkspaceEntry | undefined;
          const directory = (target?.data as { directory?: string } | undefined)
            ?.directory;
          if (entry && typeof directory === "string") move(entry, directory);
        }}
      >
        <RootDrop>
          <div className="flex h-8 items-center justify-end">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7"
                  aria-label="파일 목록 새로고침"
                  onClick={() => setRevision((n) => n + 1)}
                >
                  <RefreshCw />
                </Button>
              </TooltipTrigger>
              <TooltipContent>새로고침</TooltipContent>
            </Tooltip>
          </div>
          <SidebarGroupContent>
            <Directory
              key={id}
              {...props}
              path=""
              revision={revision}
            />
          </SidebarGroupContent>
        </RootDrop>
        <DragOverlay dropAnimation={null}>
          {(source) => {
            const entry = source.data as WorkspaceEntry;
            return (
              <div className="flex h-8 max-w-56 items-center gap-2 rounded-lg border bg-background px-2 text-sm shadow-md [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground">
                {entry.isDirectory ? <Folder /> : <FileText />}
                <span className="truncate">{entry.name}</span>
              </div>
            );
          }}
        </DragOverlay>
      </DragDropProvider>
    </TreeActions.Provider>
  );
}

/** Dropping on empty space moves the item to the top of the workspace. */
function RootDrop({ children }: { children: React.ReactNode }) {
  const { dragging } = useActions();
  const drop = useDroppable({
    id: "directory:",
    data: { directory: "" },
    collisionPriority: 0,
    disabled: !dragging || !parentOf(dragging.path),
  });
  return (
    <SidebarGroup
      ref={drop.ref}
      className={cn(
        "min-h-full rounded-lg p-2",
        drop.isDropTarget && "bg-blue-500/5",
      )}
    >
      {children}
    </SidebarGroup>
  );
}

/** Drag source for every row; folders are also drop targets. */
function useRowDnd(entry: WorkspaceEntry, disabled: boolean) {
  const { dragging, renaming } = useActions();
  const drag = useDraggable({
    id: `entry:${entry.path}`,
    data: entry,
    disabled: disabled || renaming === entry.path,
  });
  const drop = useDroppable({
    id: `directory:${entry.path}`,
    data: { directory: entry.path },
    collisionPriority: 1,
    disabled:
      !entry.isDirectory ||
      !dragging ||
      within(entry.path, dragging.path) ||
      parentOf(dragging.path) === entry.path,
  });
  return {
    ref: (element: Element | null) => {
      drag.ref(element);
      drop.ref(element);
    },
    isDragging: drag.isDragging,
    isDropTarget: drop.isDropTarget,
  };
}

function RenameInput({
  entry,
  onDone,
}: {
  entry: WorkspaceEntry;
  onDone: (name: string | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    const node = input.current;
    if (!node) return;
    node.focus();
    // Like Finder, select the name without its extension.
    const dot = entry.isDirectory ? -1 : entry.name.lastIndexOf(".");
    node.setSelectionRange(0, dot > 0 ? dot : entry.name.length);
  }, [entry]);
  const finish = (name: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(name);
  };
  return (
    <input
      ref={input}
      aria-label={`${entry.name} 새 이름`}
      defaultValue={entry.name}
      spellCheck={false}
      className="h-6 min-w-0 flex-1 rounded-sm border border-blue-500 bg-background px-1 text-sm text-foreground outline-none"
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return;
        if (e.key === "Enter") {
          e.preventDefault();
          finish(e.currentTarget.value);
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          finish(null);
        }
      }}
      onBlur={(e) => finish(e.currentTarget.value)}
    />
  );
}

function RenamingRow({
  entry,
  icon,
}: {
  entry: WorkspaceEntry;
  icon: React.ReactNode;
}) {
  const { rename } = useActions();
  return (
    <div className="flex h-8 items-center gap-2 rounded-lg bg-accent px-2 text-sm [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground">
      {icon}
      <RenameInput entry={entry} onDone={(name) => rename(entry, name)} />
    </div>
  );
}

function Directory(
  props: Props & { path: string; revision: number; nested?: boolean },
) {
  const [entries, setEntries] = useState<WorkspaceEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setFailed(false);
    void listDirectory(props.workspace.id, props.path)
      .then((value) => {
        if (live) setEntries(value);
      })
      .catch((error) => {
        if (live) {
          setFailed(true);
          props.onError(error);
        }
      });
    return () => {
      live = false;
    };
  }, [props.workspace.id, props.path, props.revision]);
  if (failed)
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          setFailed(false);
          void listDirectory(props.workspace.id, props.path)
            .then(setEntries)
            .catch(props.onError);
        }}
      >
        다시 읽기
      </Button>
    );
  if (!entries)
    return (
      <div className="flex h-8 items-center px-2">
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      </div>
    );
  if (!entries.length)
    return (
      <div className="px-2 py-1 text-xs text-muted-foreground">PDF 없음</div>
    );
  const Menu = props.nested ? SidebarMenuSub : SidebarMenu;
  return (
    <Menu
      className={
        // Nested rows start where the guide line was, without the line.
        props.nested ? "mr-0 translate-x-0 border-l-0 px-0" : undefined
      }
    >
      {entries.map((entry) =>
        entry.isDirectory ? (
          <FolderNode key={entry.path} {...props} entry={entry} />
        ) : (
          <FileNode key={entry.path} {...props} entry={entry} />
        ),
      )}
    </Menu>
  );
}

function FileNode(props: Props & { entry: WorkspaceEntry }) {
  const { renaming, menuFor, menu } = useActions();
  const dnd = useRowDnd(props.entry, props.disabled);
  return (
    <SidebarMenuItem>
      {renaming === props.entry.path ? (
        <RenamingRow entry={props.entry} icon={<FileText />} />
      ) : (
        <SidebarMenuButton
          ref={dnd.ref}
          className={cn(
            ROW,
            menuFor === props.entry.path && OUTLINED,
            dnd.isDragging && "opacity-50",
          )}
          isActive={props.activePath === props.entry.path}
          disabled={props.disabled}
          onClick={() => props.onOpen(props.entry)}
          onContextMenu={(event) => menu(props.entry, event)}
          tooltip={props.entry.path}
        >
          <FileText />
          <span>{props.entry.name}</span>
        </SidebarMenuButton>
      )}
    </SidebarMenuItem>
  );
}

function FolderNode(
  props: Props & { entry: WorkspaceEntry; revision: number },
) {
  const { renaming, menuFor, menu } = useActions();
  const dnd = useRowDnd(props.entry, props.disabled);
  const [open, setOpen] = useState(() => {
    try {
      return JSON.parse(
        localStorage.getItem(`margin-expanded:${props.workspace.id}`) ?? "[]",
      ).includes(props.entry.path);
    } catch {
      return false;
    }
  });
  const change = (value: boolean) => {
    setOpen(value);
    let paths: string[] = [];
    try {
      paths = JSON.parse(
        localStorage.getItem(`margin-expanded:${props.workspace.id}`) ?? "[]",
      );
    } catch {}
    localStorage.setItem(
      `margin-expanded:${props.workspace.id}`,
      JSON.stringify(
        value
          ? [...new Set([...paths, props.entry.path])]
          : paths.filter((path) => path !== props.entry.path),
      ),
    );
  };
  const icon = open ? <FolderOpen /> : <Folder />;
  return (
    <Collapsible asChild open={open} onOpenChange={change}>
      <SidebarMenuItem>
        {renaming === props.entry.path ? (
          <RenamingRow entry={props.entry} icon={icon} />
        ) : (
          <CollapsibleTrigger asChild>
            <SidebarMenuButton
              ref={dnd.ref}
              tooltip={props.entry.path}
              className={cn(
                "group/tree",
                ROW,
                menuFor === props.entry.path && OUTLINED,
                dnd.isDropTarget && DROP,
                dnd.isDragging && "opacity-50",
              )}
              onContextMenu={(event) => menu(props.entry, event)}
            >
              <span className="relative size-4 shrink-0 [&>svg]:absolute [&>svg]:inset-0 [&>svg]:size-4">
                {open ? (
                  <FolderOpen className="group-hover/tree:invisible group-focus-visible/tree:invisible" />
                ) : (
                  <Folder className="group-hover/tree:invisible group-focus-visible/tree:invisible" />
                )}
                <ChevronRight
                  className={
                    "invisible group-hover/tree:visible group-focus-visible/tree:visible" +
                    (open ? " rotate-90" : "")
                  }
                />
              </span>
              <span>{props.entry.name}</span>
            </SidebarMenuButton>
          </CollapsibleTrigger>
        )}
        <CollapsibleContent>
          <Directory {...props} path={props.entry.path} nested />
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
}
