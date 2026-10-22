// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown, ChevronUp, Columns3Cog, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TableColumn } from "../lib/table-columns";

export interface ColumnPickerProps {
  /** Kind name for aria labels, e.g. "Pod". */
  kindLabel: string;
  /** Visible columns, in render order — the reorderable group. */
  visible: readonly TableColumn[];
  /** Offered but hidden columns, canonical order. */
  hidden: readonly TableColumn[];
  /** True when a stored order deviates from the kind's default. */
  customized: boolean;
  onToggle(id: string): void;
  onMove(id: string, delta: number): void;
  onReset(): void;
}

/**
 * Per-kind column picker: a small popover from the resource pane heading.
 * Keyboard-first like the rest of the table — each row is one tab stop:
 * Space/Enter toggles visibility, ArrowUp/ArrowDown moves the column and
 * keeps focus on it. No drag library; the same move operation is exposed
 * as chevron buttons for pointer users.
 */
export function ColumnPicker({ kindLabel, visible, hidden, customized, onToggle, onMove, onReset }: ColumnPickerProps) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (wrapper.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    // Escape is document-level (capture) so it closes the picker even when
    // focus fell back to <body> — e.g. right after a toggle moved the row
    // between the shown and hidden lists. Capture + stopPropagation keeps
    // the keystroke from also dismissing whatever sits behind the picker.
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  const hiddenCurated = hidden.filter((column) => column.source !== "discovered");
  const hiddenDiscovered = hidden.filter((column) => column.source === "discovered");

  const renderRow = (column: TableColumn, index: number, shown: boolean) => (
    <li className="column-picker-row" role="listitem" key={column.id}>
      <button
        type="button"
        className="column-picker-toggle"
        data-testid={`column-toggle-${column.id}`}
        aria-pressed={shown}
        aria-label={shown
          ? `${column.label}, shown, position ${index + 1} of ${visible.length}`
          : `${column.label}, hidden`}
        title={shown && visible.length <= 1 ? "At least one column must stay visible" : shown ? undefined : "Show this column"}
        onClick={() => onToggle(column.id)}
        onKeyDown={(event) => {
          if (!shown) return;
          if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            onMove(column.id, event.key === "ArrowUp" ? -1 : 1);
          }
        }}
      >
        <span className="column-picker-check" aria-hidden="true">
          {shown ? <Check size={12} /> : null}
        </span>
        <span className="column-picker-label">{column.label}</span>
      </button>
      {shown ? (
        <span className="column-picker-move">
          <button
            type="button"
            tabIndex={-1}
            aria-label={`Move ${column.label} up`}
            disabled={index === 0}
            onClick={() => onMove(column.id, -1)}
          >
            <ChevronUp size={12} />
          </button>
          <button
            type="button"
            tabIndex={-1}
            aria-label={`Move ${column.label} down`}
            disabled={index === visible.length - 1}
            onClick={() => onMove(column.id, 1)}
          >
            <ChevronDown size={12} />
          </button>
        </span>
      ) : null}
    </li>
  );

  return (
    <div className="column-picker" ref={wrapper}>
      <Button
        variant="outline"
        size="sm"
        ref={trigger}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-testid="table-columns-trigger"
        onClick={() => setOpen((current) => !current)}
      >
        <Columns3Cog aria-hidden="true" />
        Columns
      </Button>
      {open ? (
        <div
          className="column-picker-panel"
          role="dialog"
          aria-label={`Customize ${kindLabel} columns`}
          data-testid="column-picker"
        >
          <p className="column-picker-heading">Shown</p>
          <ul className="column-picker-list" role="list">
            {visible.map((column, index) => renderRow(column, index, true))}
          </ul>
          {hidden.length > 0 ? (
            <>
              <p className="column-picker-heading">More columns</p>
              <ul className="column-picker-list" role="list">
                {hiddenCurated.map((column) => renderRow(column, -1, false))}
              </ul>
              {hiddenDiscovered.length > 0 ? (
                <>
                  <p className="column-picker-heading column-picker-discovered">Found in loaded rows</p>
                  <ul className="column-picker-list" role="list">
                    {hiddenDiscovered.map((column) => renderRow(column, -1, false))}
                  </ul>
                </>
              ) : null}
            </>
          ) : null}
          <div className="column-picker-footer">
            <Button
              variant="ghost"
              size="sm"
              disabled={!customized}
              data-testid="column-picker-reset"
              onClick={onReset}
            >
              <RotateCcw aria-hidden="true" />
              Reset to default
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
