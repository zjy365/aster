// SPDX-License-Identifier: Apache-2.0
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { yaml } from "@codemirror/lang-yaml";
import { HighlightStyle, indentOnInput, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { Annotation, Compartment, EditorState, Transaction } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, placeholder as placeholderExtension } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { useLayoutEffect, useRef } from "react";

interface YamlEditorProps {
  value: string;
  onChange(value: string): void;
  readOnly?: boolean;
  autoFocus?: boolean;
  placeholder?: string;
  className?: string;
  "aria-label": string;
  "data-testid": string;
}

const externalValue = Annotation.define<boolean>();

const highlighting = syntaxHighlighting(HighlightStyle.define([
  { tag: [tags.propertyName, tags.attributeName], color: "var(--text)" },
  { tag: [tags.string, tags.content], color: "var(--healthy)" },
  { tag: [tags.keyword, tags.labelName, tags.typeName], color: "var(--warning)" },
  { tag: tags.comment, color: "var(--text-secondary)", fontStyle: "italic" },
  { tag: [tags.meta, tags.punctuation], color: "var(--text-secondary)" },
]));

/** A single YAML-only editing surface; CodeMirror owns selection and IME DOM. */
export function YamlEditor(props: YamlEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const latest = useRef(props);
  const configuration = useRef(new Compartment());

  useLayoutEffect(() => {
    latest.current = props;
  });

  useLayoutEffect(() => {
    const editor = new EditorView({
      parent: host.current!,
      doc: latest.current.value,
      extensions: [
        yaml(), lineNumbers(), history(), indentOnInput(), indentUnit.of("  "),
        EditorState.tabSize.of(2), highlighting,
        // Leave Tab available for keyboard navigation out of the editor.
        keymap.of([...defaultKeymap, ...historyKeymap]),
        configuration.current.of([]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !update.transactions.every((transaction) => transaction.annotation(externalValue))) {
            latest.current.onChange(update.state.doc.toString());
          }
        }),
      ],
    });
    view.current = editor;
    if (latest.current.autoFocus) editor.focus();
    return () => {
      view.current = null;
      editor.destroy();
    };
  }, []);

  useLayoutEffect(() => {
    view.current?.dispatch({
      effects: configuration.current.reconfigure([
        EditorState.readOnly.of(props.readOnly ?? false),
        EditorView.contentAttributes.of({
          "aria-label": props["aria-label"],
          "aria-readonly": String(props.readOnly ?? false),
          "data-testid": props["data-testid"],
          spellcheck: "false",
        }),
        placeholderExtension(props.placeholder ?? ""),
      ]),
    });
  }, [props.readOnly, props["aria-label"], props["data-testid"], props.placeholder]);

  useLayoutEffect(() => {
    const editor = view.current!;
    // React's echo of an edit must never replace the composing DOM or cursor.
    if (editor.state.doc.toString() === props.value) return;
    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: props.value },
      annotations: [externalValue.of(true), Transaction.addToHistory.of(false)],
    });
  }, [props.value]);

  return <div ref={host} className={`resource-yaml-editor ${props.className ?? ""}`} />;
}
