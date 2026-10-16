"use client";

import { useEffect, useRef, useState } from "react";

interface ChatContainerProps {
  children: React.ReactNode;
  className?: string;
  autoScroll?: boolean;
}

export function ChatContainer({
  children,
  className,
  autoScroll = true,
}: ChatContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [bottom, setBottom] = useState(-1);

  useEffect(() => {
    if (!autoScroll) return;
    const container = containerRef.current;
    if (!container) return;

    const isAtBottom =
      container.scrollHeight - container.scrollTop <= container.clientHeight + 10;

    if (isAtBottom || bottom === -1) {
      container.scrollTop = container.scrollHeight;
    }
  }, [children, autoScroll, bottom]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "flex h-full flex-col gap-4 overflow-y-auto pr-2",
        className
      )}
      onScroll={() => {
        if (!containerRef.current) return;
        const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
        const nearBottom = scrollHeight - scrollTop <= clientHeight + 50;
        setBottom(nearBottom ? -1 : scrollTop);
      }}
    >
      {children}
    </div>
  );
}

function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(" ");
}