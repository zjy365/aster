// SPDX-License-Identifier: Apache-2.0
import { Command } from "cmdk";
import { Check, Search } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import {
  commandFilter,
  groupCommandItems,
  type CommandAction,
  type CommandItem,
} from "../lib/command-palette";

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  items: CommandItem[];
  onExecute(action: CommandAction): void;
  onQueryChange?(query: string): void;
  /** Linear-style contextual mode: the object the palette operates on. */
  context?: { kind: string; name: string };
}

/**
 * The ⌘K surface: item construction and matching live in lib/command-palette;
 * this component only renders the cmdk list inside the shared dialog shell
 * and reports the chosen action back to the composition root.
 */
export function CommandPalette({ open, onOpenChange, items, onExecute, onQueryChange, context }: CommandPaletteProps) {
  const groups = groupCommandItems(items);

  return (
    <Dialog open={open} onOpenChange={(next) => onOpenChange(next)}>
      <DialogContent
        showCloseButton={false}
        className="command-palette-content"
        data-testid="command-palette"
        aria-label="Command palette"
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <Command label="Command palette" filter={commandFilter} loop>
          <div className="command-palette-field">
            <Search aria-hidden="true" />
            <Command.Input
              placeholder="Type a command or search…"
              className="command-palette-input"
              data-testid="command-palette-input"
              onValueChange={onQueryChange}
            />
            {context ? (
              <span className="command-palette-context" data-testid="command-palette-context">
                {context.kind} · {context.name}
              </span>
            ) : null}
          </div>
          <Command.List className="command-palette-list">
            <Command.Empty className="command-palette-empty">No matching commands.</Command.Empty>
            {groups.map((group) => (
              <Command.Group
                heading={group.heading}
                key={group.id}
                className="command-palette-group"
              >
                {group.items.map((item) => (
                  <Command.Item
                    key={item.id}
                    value={item.id}
                    keywords={[item.label, item.hint ?? "", ...item.keywords]}
                    disabled={item.disabled}
                    onSelect={() => {
                      onOpenChange(false);
                      onExecute(item.action);
                    }}
                    className="command-palette-item"
                    data-testid={`command-item-${item.id}`}
                  >
                    <span className="command-palette-item-label">{item.label}</span>
                    {item.hint ? <Kbd className="command-palette-item-hint">{item.hint}</Kbd> : null}
                    {item.current ? <Check aria-hidden="true" className="command-palette-item-check" /> : null}
                  </Command.Item>
                ))}
              </Command.Group>
            ))}
          </Command.List>
          <div className="command-palette-footer" aria-hidden="true">
            <span><Kbd>↑</Kbd><Kbd>↓</Kbd> Navigate</span>
            <span><Kbd>↵</Kbd> Run</span>
            <span><Kbd>esc</Kbd> Close</span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
