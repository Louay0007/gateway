"use client";

import type { CSSProperties, ReactNode } from "react";

export interface RuixenGradientFooterProps {
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

export function RuixenGradientFooter({
  children,
  className,
  style,
}: RuixenGradientFooterProps) {
  return (
    <footer
      className={`relative bg-white dark:bg-black ${className ?? ""}`}
      style={style}
    >
      {children}
    </footer>
  );
}