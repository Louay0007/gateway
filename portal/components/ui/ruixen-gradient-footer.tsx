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
      className={className}
      style={{ position: "relative", backgroundColor: "#ffffff", ...style }}
    >
      {children}
    </footer>
  );
}