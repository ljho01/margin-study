import type { RefObject } from "react";
import { DragDropProvider } from "@dnd-kit/react";
import { isSortable, useSortable } from "@dnd-kit/react/sortable";
import { PointerActivationConstraints, PointerSensor } from "@dnd-kit/dom";
import { Modifier, type DragOperation } from "@dnd-kit/abstract";
import {
  ArrowUp,
  CornerDownRight,
  History,
  Loader2,
  MessageSquare,
  PanelRight,
  Pencil,
  Play,
  Plus,
  Square,
  X,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IconButton } from "@/components/IconButton";
import ChatMarkdown from "@/components/ChatMarkdown";
import ChatComposer, { type ComposerHandle } from "@/components/ChatComposer";
import { cn } from "@/lib/utils";
import { quotesAsText, quotesOf, withoutQuotes } from "@/lib/quotes";
import type { ChatSession } from "@/lib/types";
import type { useStudy } from "@/hooks/use-study";

const Pointer = PointerSensor.configure({
  activationConstraints: [
    new PointerActivationConstraints.Distance({ value: 5 }),
  ],
});
class HorizontalAxis extends Modifier {
  apply(operation: DragOperation) {
    return { x: operation.transform.x, y: 0 };
  }
}

function ChatTab({
  session,
  index,
  active,
  streaming,
  onActivate,
  onClose,
}: {
  session: ChatSession;
  index: number;
  active: boolean;
  streaming: boolean;
  onActivate: () => void;
  onClose: () => void;
}) {
  const sortable = useSortable({
    id: session.id,
    index,
    group: "chat-tabs",
    type: "chat-tab",
    accept: "chat-tab",
    transition: { duration: 180, easing: "cubic-bezier(0.2, 0, 0, 1)" },
  });
  return (
    <div
      ref={sortable.ref}
      className={cn(
        "group/tab relative flex h-8 max-w-56 min-w-28 flex-none items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground data-[dragging]:z-10 data-[dragging]:opacity-50",
        active && "bg-accent text-foreground",
      )}
      data-dragging={sortable.isDragging || undefined}
      onMouseDown={onActivate}
    >
      <button
        ref={sortable.handleRef}
        type="button"
        role="tab"
        aria-selected={active}
        title={session.title}
        className="flex min-w-0 flex-1 cursor-default touch-none items-center gap-2 pr-8 pl-2.5 text-sm outline-none"
      >
        {streaming ? (
          <Loader2 className="size-4 flex-none animate-spin" />
        ) : (
          <MessageSquare className="size-4 flex-none" />
        )}
        <span className="truncate">{session.title}</span>
      </button>
      <button
        type="button"
        aria-label={`${session.title} 닫기`}
        disabled={streaming}
        className="absolute right-1 grid size-6 place-items-center rounded-sm opacity-0 group-hover/tab:opacity-100 hover:bg-accent hover:text-foreground disabled:hidden"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

export default function ChatPanel({
  s,
  input,
  newChatHotkey,
}: {
  s: ReturnType<typeof useStudy>;
  input: RefObject<ComposerHandle | null>;
  newChatHotkey: string;
}) {
  const doc = s.doc!;
  const tabs = (doc.openChats ?? [])
    .map((id) => doc.sessions?.find((x) => x.id === id))
    .filter((x): x is ChatSession => !!x);
  const typed = !!s.question.trim();
  const pageLabel = (page: number) => {
    const index = doc.pages.indexOf(page);
    return index < 0 ? `원본 ${page}` : String(index + 1);
  };
  return (
    <aside className="flex h-full min-h-0 flex-col" data-chat-panel>
      <header
        className="flex h-11 shrink-0 items-center gap-1 border-b px-1.5"
        data-tauri-drag-region
      >
        <DragDropProvider
          sensors={[Pointer]}
          modifiers={[HorizontalAxis.configure({})]}
          onDragEnd={(event) => {
            if (event.canceled) return;
            const { source } = event.operation;
            if (isSortable(source)) s.moveChat(String(source.id), source.index);
          }}
        >
          <div
            role="tablist"
            aria-label="대화"
            className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none]"
          >
            {tabs.map((session, index) => (
              <ChatTab
                key={session.id}
                session={session}
                index={index}
                active={session.id === doc.activeChat}
                streaming={s.streamingChats.includes(session.id)}
                onActivate={() => s.openChat(session.id)}
                onClose={() => s.closeChat(session.id)}
              />
            ))}
            <div className="h-8 min-w-2 flex-1" data-tauri-drag-region />
          </div>
        </DragDropProvider>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon-sm" variant="ghost" aria-label="대화 기록">
              <History />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            {s.chatHistory.map((session) => (
              <DropdownMenuItem
                key={session.id}
                onSelect={() => s.openChat(session.id)}
              >
                <MessageSquare />
                <span className="truncate">{session.title}</span>
              </DropdownMenuItem>
            ))}
            {!s.chatHistory.length && (
              <DropdownMenuItem disabled>대화 없음</DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <IconButton
          label="새 대화"
          hotkey={newChatHotkey}
          onClick={() => {
            s.newChat();
            requestAnimationFrame(() => input.current?.focus());
          }}
        >
          <Plus />
        </IconButton>
        <IconButton
          label="질문 패널 닫기"
          onClick={() => s.setRightOpen(false)}
        >
          <PanelRight />
        </IconButton>
      </header>
      {/* Radix lays the viewport content out as a table, which grows to the
          widest line; a block keeps messages at the panel width. */}
      <ScrollArea className="min-h-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:!block">
        <div className="min-w-0 space-y-6 p-4">
          {s.messages.map((message, index) => {
            const live = message.id === s.liveAnswer;
            const resumable =
              message.stopped &&
              !s.chatBusy &&
              index === s.messages.length - 1;
            const quotes = message.role === "user" ? quotesOf(message.text) : [];
            const shown = quotes.length ? withoutQuotes(message.text) : message.text;
            return (
              <div
                key={message.id}
                className={
                  message.role === "user"
                    ? "ml-4 rounded-lg bg-muted px-3 py-2"
                    : "text-sm"
                }
              >
                {!!quotes.length && (
                  // Attached passages, like files attached to a message.
                  <ul className={cn("space-y-1", shown && "mb-2")}>
                    {quotes.map((quote, i) => (
                      <li
                        key={i}
                        className="border-l-2 pl-2 text-xs leading-5 text-muted-foreground"
                      >
                        <span className="mr-1.5 font-medium text-foreground tabular-nums">
                          {pageLabel(quote.page)}쪽
                        </span>
                        <span className="line-clamp-3">{quote.text}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {shown ? (
                  <ChatMarkdown streaming={live}>{shown}</ChatMarkdown>
                ) : live ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : resumable || quotes.length ? null : (
                  <span className="text-sm text-muted-foreground">
                    답변 중단
                  </span>
                )}
                {resumable && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className={cn(
                      "-ml-2 text-muted-foreground hover:text-foreground",
                      message.text && "mt-2",
                    )}
                    onClick={() => s.resumeChat(message)}
                  >
                    <Play />
                    이어서
                  </Button>
                )}
              </div>
            );
          })}
          <div ref={s.chatEnd} />
        </div>
      </ScrollArea>
      <form
        className="relative m-3 shrink-0"
        onSubmit={(e) => {
          e.preventDefault();
          void s.sendChat();
        }}
      >
        {!!s.queue.length && (
          <ul aria-label="대기 중인 질문" className="mb-2 space-y-1">
            {s.queue.map((item) => (
              <li
                key={item.id}
                className="flex items-center gap-1 rounded-lg border bg-muted/50 py-1 pr-1 pl-2.5 text-sm"
              >
                <CornerDownRight className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">
                  {quotesAsText(item.text)}
                </span>
                <IconButton
                  label="지금 보내기"
                  className="size-7"
                  type="button"
                  onClick={() => s.sendQueuedNow(item.id)}
                >
                  <ArrowUp />
                </IconButton>
                <IconButton
                  label="수정"
                  hotkey="ArrowUp"
                  className="size-7"
                  type="button"
                  onClick={() => {
                    s.editQueued(item.id);
                    requestAnimationFrame(() => input.current?.focus());
                  }}
                >
                  <Pencil />
                </IconButton>
                <IconButton
                  label="삭제"
                  className="size-7"
                  type="button"
                  onClick={() => s.removeQueued(item.id)}
                >
                  <X />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
        <ChatComposer
          ref={input}
          label="현재 페이지에 질문하기"
          placeholder="질문 입력"
          className="pb-12"
          value={s.question}
          onChange={s.setQuestion}
          onSubmit={() => void s.sendChat()}
          onArrowUp={() => {
            // Like Codex: Up pulls the last waiting question back in to edit.
            const last = s.queue.at(-1);
            if (!last) return false;
            s.editQueued(last.id);
            return true;
          }}
          pageLabel={pageLabel}
        />
        {s.chatBusy && !typed ? (
          <Button
            className="absolute right-2 bottom-2"
            size="icon-sm"
            type="button"
            aria-label="답변 중지"
            onClick={() => s.stopChat()}
          >
            <Square />
          </Button>
        ) : !typed && s.queuePaused && s.queue.length ? (
          <Button
            className="absolute right-2 bottom-2"
            size="icon-sm"
            type="button"
            aria-label="대기열 재개"
            onClick={s.resumeQueue}
          >
            <Play />
          </Button>
        ) : (
          <Button
            className="absolute right-2 bottom-2"
            size="icon-sm"
            type="submit"
            aria-label={s.chatBusy ? "대기열에 추가" : "질문 보내기"}
            disabled={!typed}
          >
            <ArrowUp />
          </Button>
        )}
      </form>
    </aside>
  );
}
