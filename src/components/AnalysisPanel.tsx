import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { IconButton } from "@/components/IconButton";
import Markdown from "@/components/Markdown";
import { Square } from "@/components/icons";
import type { useStudy } from "@/hooks/use-study";

type Study = ReturnType<typeof useStudy>;

/** Centered message with an optional row of actions, like shadcn's Empty. */
function Fallback({
  title,
  description,
  error,
  children,
}: {
  title: string;
  description: ReactNode;
  error?: string;
  children?: ReactNode;
}) {
  return (
    <Empty className="h-full gap-4 p-6 md:p-6">
      <EmptyHeader>
        <EmptyTitle className="text-base">{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
      </EmptyHeader>
      {children && (
        <EmptyContent className="flex-row justify-center gap-2">
          {children}
        </EmptyContent>
      )}
    </Empty>
  );
}

/** The bottom panel: explanation, translation and key points of a page. */
export default function AnalysisPanel({ s }: { s: Study }) {
  const { doc, analysis, processing } = s;
  if (!doc) return null;
  const allDone = s.doneCount === doc.pages.length;
  const translate = (all: boolean) => {
    s.setTranslate(true);
    void s.runAnalysis(all, !all, true);
  };

  let body: ReactNode;
  if (processing && (!analysis || (s.tab === "translation" && !analysis.translation)))
    body = (
      <Fallback
        title="처리하는 중"
        description={
          <span className="tabular-nums">
            {processing.total}페이지 중 {processing.done}페이지를 마쳤어요.
          </span>
        }
      >
        <Progress
          value={(processing.done / processing.total) * 100}
          className="w-40"
        />
        <Button
          size="sm"
          variant="secondary"
          onClick={() => void s.stopProcessing()}
        >
          중지
        </Button>
      </Fallback>
    );
  else if (!analysis)
    body = (
      <Fallback
        title="아직 정리한 내용이 없어요"
        description="AI가 페이지를 읽고 해설, 번역, 핵심을 정리해 드려요."
        error={s.processingError}
      >
        <Button
          size="sm"
          disabled={s.chatBusy}
          onClick={() => void s.runAnalysis(false, true)}
        >
          이 페이지 처리
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={s.chatBusy || allDone}
          onClick={() => void s.runAnalysis(true)}
        >
          문서 전체 처리
        </Button>
      </Fallback>
    );
  else if (s.tab === "translation" && !analysis.translation)
    body = analysis.translationRequested ? (
      <Fallback
        title="번역할 내용이 없어요"
        description="이 페이지에서는 한국어로 옮길 글을 찾지 못했어요."
      />
    ) : (
      <Fallback
        title="아직 번역하지 않았어요"
        description="이 페이지의 글을 한국어로 옮겨 드려요."
        error={s.processingError}
      >
        <Button
          size="sm"
          disabled={s.chatBusy}
          onClick={() => translate(false)}
        >
          이 페이지 번역
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={s.chatBusy}
          onClick={() => translate(true)}
        >
          문서 전체 번역
        </Button>
      </Fallback>
    );
  else
    body = (
      <ScrollArea className="h-full">
        <div className="p-4">
          {s.tab === "explanation" && (
            <>
              <h2 className="mb-4 pr-28 text-base font-semibold">
                {analysis.title}
              </h2>
              <Markdown>{analysis.explanation}</Markdown>
            </>
          )}
          {s.tab === "translation" && (
            <div className="pr-28">
              <Markdown>{analysis.translation}</Markdown>
            </div>
          )}
          {s.tab === "points" && (
            <ul className="list-disc space-y-3 pr-28 pl-5">
              {analysis.keyPoints.map((point, index) => (
                <li key={index}>
                  <Markdown>{point}</Markdown>
                </li>
              ))}
            </ul>
          )}
          {s.processingError && (
            <p className="mt-4 text-sm text-destructive" role="alert">
              {s.processingError}
            </p>
          )}
        </div>
      </ScrollArea>
    );

  return (
    <div className="relative h-full">
      {analysis && (
        <div className="absolute top-2 right-3 z-10 flex items-center gap-2">
          {processing && (
            // Other pages are still being processed in the background.
            <div className="flex h-8 items-center gap-2 rounded-md border bg-background/95 pr-1 pl-3 shadow-xs backdrop-blur">
              <Progress
                value={(processing.done / processing.total) * 100}
                className="w-16"
              />
              <span className="text-xs tabular-nums">
                {processing.done}/{processing.total}
              </span>
              <IconButton
                label="처리 중지"
                onClick={() => void s.stopProcessing()}
              >
                <Square />
              </IconButton>
            </div>
          )}
          <Select value={s.tab} onValueChange={s.setTab}>
            <SelectTrigger
              size="sm"
              aria-label="보기"
              className="bg-background shadow-xs dark:bg-background"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value="explanation">해설</SelectItem>
              <SelectItem value="translation">번역</SelectItem>
              <SelectItem value="points">핵심</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
      {body}
    </div>
  );
}
