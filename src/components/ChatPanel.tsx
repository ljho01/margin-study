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
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IconButton } from "@/components/IconButton";
import ChatMarkdown from "@/components/ChatMarkdown";
import { cn } from "@/lib/utils";
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
  input: RefObject<HTMLTextAreaElement | null>;
  newChatHotkey: string;
}) {
  const doc = s.doc!;
  const tabs = (doc.openChats ?? [])
    .map((id) => doc.sessions?.find((x) => x.id === id))
    .filter((x): x is ChatSession => !!x);
  const typed = !!s.question.trim();
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
                streaming={session.id === s.streamingChat}
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
            const live = s.chatBusy && message.id === s.chatRequest.current;
            const resumable =
              message.stopped &&
              !s.chatBusy &&
              index === s.messages.length - 1;
            return (
              <div
                key={message.id}
                className={
                  message.role === "user"
                    ? "ml-4 rounded-lg bg-muted px-3 py-2"
                    : "text-sm"
                }
              >
                {message.text ? (
                  <ChatMarkdown streaming={live}>{message.text}</ChatMarkdown>
                ) : live ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : resumable ? null : (
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
                <span className="min-w-0 flex-1 truncate">{item.text}</span>
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
        <Textarea
          ref={input}
          aria-label="현재 페이지에 질문하기"
          placeholder="질문 입력"
          rows={3}
          className="min-h-24 resize-none pb-12"
          value={s.question}
          onChange={(e) => s.setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              void s.sendChat();
            }
          }}
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
            onClick={() => s.setQueuePaused(false)}
          >
            <Play />
          </Button>
        ) : (
          <Button
            className="absolute right-2 bottom-2"
            size="icon-sm"
            type="submit"
            aria-label={s.busy ? "대기열에 추가" : "질문 보내기"}
            disabled={!typed}
          >
            <ArrowUp />
          </Button>
        )}
      </form>
    </aside>
  );
}
