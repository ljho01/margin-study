import type { ComponentProps, ReactNode } from "react";
import { formatForDisplay } from "@tanstack/react-hotkeys";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function IconButton({
  label,
  hotkey,
  children,
  className,
  ...props
}: ComponentProps<typeof Button> & {
  label: string;
  hotkey?: string;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={label}
          className={cn(
            "text-muted-foreground hover:bg-accent hover:text-foreground aria-pressed:bg-accent aria-pressed:text-foreground",
            className,
          )}
          {...props}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {label}
        {hotkey && (
          <span className="ml-2 text-muted-foreground">
            {formatForDisplay(hotkey)}
          </span>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
