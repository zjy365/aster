import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface WorkbenchShellProps {
  sidebar: ReactNode;
  toolbar: ReactNode;
  children: ReactNode;
  className?: string;
  mainClassName?: string;
}

/**
 * The persistent desktop frame: a fixed source list and one primary workspace.
 * Navigation and application state remain owned by the caller.
 */
export function WorkbenchShell({
  sidebar,
  toolbar,
  children,
  className,
  mainClassName,
}: WorkbenchShellProps) {
  return (
    <div
        className={cn("workbench-shell", className)}
        data-testid="workbench-shell"
      >
        {sidebar}
        <div className="workbench-main-column">
          {toolbar}
          <main
            className={cn("main-workspace", mainClassName)}
            data-testid="main-workspace"
          >
            {children}
          </main>
        </div>
    </div>
  );
}
