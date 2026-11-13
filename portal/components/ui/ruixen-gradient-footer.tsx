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
      className={`relative bg-background ${className ?? ""}`}
      style={style}
    >
      {children}
    </footer>
  );
}