/**
 * Build the initial content for a note created *as* a type (#1064): the `type:`
 * frontmatter, an empty scaffold of the type's declared property keys, then the
 * (already-substituted) template body. Shared so the type picker (#1064) and
 * inline `/book` creation (#1065) produce identical notes.
 *
 * Frontmatter is the storage format, never the interface — the scaffold gives
 * the property form (#1066) its keys, but the user never has to hand-write them.
 */
import type { TypeInfo } from './type-def';

export interface TypedNoteScaffold {
  content: string;
  /** Caret offset — start of the body, past the frontmatter. */
  caretOffset: number;
}

/** `body` is the type's template body, already run through substituteTemplate. */
export function buildTypedNoteScaffold(type: TypeInfo, body: string): TypedNoteScaffold {
  const fm = ['---', `type: ${type.id}`];
  for (const p of type.properties) fm.push(`${p.name}:`);
  fm.push('---', '');
  const prefix = fm.join('\n'); // ends with `---\n` (the trailing '' adds the newline)
  const trimmedBody = body.replace(/^\n+/, '');
  return {
    content: trimmedBody ? `${prefix}\n${trimmedBody}${trimmedBody.endsWith('\n') ? '' : '\n'}` : prefix,
    caretOffset: prefix.length + 1,
  };
}
