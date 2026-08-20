// SPDX-License-Identifier: Apache-2.0
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Keyboard hint chip (Linear-style): a mono, faint, raised-fill key cap.
 * Per the Keyboard Hint Rule, shortcuts render as chips beside the action
 * they trigger — in buttons, menus, command rows, and empty states.
 */
export function Kbd({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <kbd className={cn("kbd-chip", className)}>{children}</kbd>;
}
