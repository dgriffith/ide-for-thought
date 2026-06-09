import { describe, it, expect } from 'vitest';
import {
  renderTemplate,
  renderTemplateDiagnostic,
  toRenderContext,
  type SkillRenderContext,
} from '../../src/main/skills/template';
import type { ToolContext } from '../../src/shared/tools/types';

function ctx(partial: Partial<SkillRenderContext> = {}): SkillRenderContext {
  return {
    selection: '',
    note: null,
    claim: null,
    param: {},
    ...partial,
  };
}

describe('renderTemplate — interpolation', () => {
  it('interpolates selection and params', () => {
    expect(renderTemplate('A {{selection}} B {{param.x}} C', ctx({ selection: 'sel', param: { x: 'PX' } })))
      .toBe('A sel B PX C');
  });

  it('renders unknown variables as empty (lenient)', () => {
    expect(renderTemplate('[{{nope}}]', ctx())).toBe('[]');
  });

  it('renders dotted note/claim fields, empty when slot absent', () => {
    expect(renderTemplate('{{note.title}}|{{claim.label}}', ctx())).toBe('|');
    expect(
      renderTemplate('{{note.title}}|{{claim.label}}', ctx({
        note: { content: 'c', title: 'T', path: 'p' },
        claim: { uri: 'u', label: 'L', sourceText: 's' },
      })),
    ).toBe('T|L');
  });
});

describe('renderTemplate — filters', () => {
  it('blockquotes a multi-line passage', () => {
    expect(renderTemplate('{{claim.sourceText | blockquote}}', ctx({
      claim: { uri: 'u', label: '', sourceText: 'one\ntwo\nthree' },
    }))).toBe('> one\n> two\n> three');
  });

  it('chains trim then upper', () => {
    expect(renderTemplate('{{selection | trim | upper}}', ctx({ selection: '  hi ' }))).toBe('HI');
  });
});

describe('renderTemplate — conditionals', () => {
  it('takes the then/else branch by object presence', () => {
    const t = '{{#if note}}has note{{else}}no note{{/if}}';
    expect(renderTemplate(t, ctx())).toBe('no note');
    expect(renderTemplate(t, ctx({ note: { content: 'c', title: '', path: '' } }))).toBe('has note');
  });

  it('treats empty strings as falsy', () => {
    expect(renderTemplate('{{#if selection}}Y{{else}}N{{/if}}', ctx({ selection: '' }))).toBe('N');
    expect(renderTemplate('{{#if selection}}Y{{else}}N{{/if}}', ctx({ selection: 'x' }))).toBe('Y');
  });

  it('supports negation', () => {
    expect(renderTemplate('{{#if !note}}none{{/if}}', ctx())).toBe('none');
    expect(renderTemplate('{{#if !note}}none{{/if}}', ctx({ note: { content: 'c', title: '', path: '' } }))).toBe('');
  });

  it('nests conditionals', () => {
    const t = '{{#if note}}{{#if note.title}}T:{{note.title}}{{else}}untitled{{/if}}{{/if}}';
    expect(renderTemplate(t, ctx({ note: { content: 'c', title: 'Hi', path: '' } }))).toBe('T:Hi');
    expect(renderTemplate(t, ctx({ note: { content: 'c', title: '', path: '' } }))).toBe('untitled');
  });
});

describe('renderTemplate — standalone whitespace', () => {
  it('a block tag alone on its line leaves no blank line behind', () => {
    const t = 'before\n{{#if note}}\nIN\n{{/if}}\nafter';
    // note absent → the whole if region collapses cleanly
    expect(renderTemplate(t, ctx())).toBe('before\nafter');
    // note present → only IN survives between before/after
    expect(renderTemplate(t, ctx({ note: { content: 'c', title: '', path: '' } }))).toBe('before\nIN\nafter');
  });

  it('does not trim inline (non-standalone) tags', () => {
    expect(renderTemplate('x {{#if selection}}Y{{/if}} z', ctx({ selection: 's' }))).toBe('x Y z');
  });
});

describe('renderTemplateDiagnostic', () => {
  it('collects unknown variables and filters', () => {
    const r = renderTemplateDiagnostic('{{bogus}} {{selection | nope}}', ctx({ selection: 's' }));
    expect(r.errors).toContain('unknown variable "bogus"');
    expect(r.errors).toContain('unknown filter "nope"');
  });

  it('throws on unbalanced blocks', () => {
    expect(() => renderTemplate('{{#if note}}x', ctx())).toThrow(/unclosed/);
    expect(() => renderTemplate('x{{/if}}', ctx())).toThrow(/unexpected/);
  });
});

describe('toRenderContext', () => {
  it('maps ToolContext, nulling absent note/claim', () => {
    const tc: ToolContext = { selectedText: 's', parameterValues: { a: '1' } };
    expect(toRenderContext(tc)).toEqual({ selection: 's', note: null, claim: null, param: { a: '1' } });
  });

  it('builds note/claim slots when present', () => {
    const tc: ToolContext = {
      fullNoteContent: 'C', fullNoteTitle: 'T', fullNotePath: 'p.md',
      claimUri: 'urn:1', claimLabel: 'L', claimSourceText: 'src',
    };
    const r = toRenderContext(tc);
    expect(r.note).toEqual({ content: 'C', title: 'T', path: 'p.md' });
    expect(r.claim).toEqual({ uri: 'urn:1', label: 'L', sourceText: 'src' });
  });
});

// --- Acceptance: reproduce the current hardcoded builders byte-for-byte ------
// These are the hardest existing prompts (#623). Proving the engine can express
// them de-risks migrating all 35 tools to skill files.

describe('acceptance: find-arguments first message (support polarity)', () => {
  // Mirrors buildFindArgumentsFirstMessage('support', ctx) in
  // research/find-arguments-shared.ts. The migrated find-supporting skill bakes
  // in the "support" wording (the opposing skill is a separate file).
  const TMPL =
    "{{#if claim.label}}Find the strongest arguments that support this claim:\n\n**{{claim.label}}**{{else}}Find the strongest arguments that support the claim under discussion.{{/if}}{{#if claim.sourceText}}\n\n{{claim.sourceText | blockquote}}{{/if}}\n\nUse web search freely. When you're satisfied with the case, ask me to file — I'll review the proposed note before anything lands.";

  const expected = (claimLabel: string, claimSourceText: string): string => {
    const verb = 'support';
    const headline = claimLabel
      ? `Find the strongest arguments that ${verb} this claim:\n\n**${claimLabel}**`
      : `Find the strongest arguments that ${verb} the claim under discussion.`;
    const sourceBlock = claimSourceText
      ? '\n\n' + claimSourceText.split(/\r?\n/).map((l) => `> ${l}`).join('\n')
      : '';
    return `${headline}${sourceBlock}\n\nUse web search freely. When you're satisfied with the case, ask me to file — I'll review the proposed note before anything lands.`;
  };

  it('label + multi-line source', () => {
    const c = ctx({ claim: { uri: 'u', label: 'AI will plateau', sourceText: 'line one\nline two' } });
    expect(renderTemplate(TMPL, c)).toBe(expected('AI will plateau', 'line one\nline two'));
  });
  it('no label, no source', () => {
    const c = ctx({ claim: { uri: 'u', label: '', sourceText: '' } });
    expect(renderTemplate(TMPL, c)).toBe(expected('', ''));
  });
  it('no label, with source', () => {
    const c = ctx({ claim: { uri: 'u', label: '', sourceText: 'src' } });
    expect(renderTemplate(TMPL, c)).toBe(expected('', 'src'));
  });
});

describe('acceptance: find-arguments claim block (system-prompt tail)', () => {
  // Mirrors the claimBlock built in buildFindArgumentsSystemPrompt.
  const TMPL =
    "## Claim\n**URI:** `{{claim.uri}}`{{#if claim.label}}\n**Label:** {{claim.label}}{{/if}}{{#if claim.sourceText}}\n**Source passage:**\n\n{{claim.sourceText | blockquote}}{{/if}}";

  const expected = (uri: string, claimLabel: string, claimSourceText: string): string =>
    [
      '## Claim',
      '',
      `**URI:** \`${uri}\``,
      '',
      claimLabel ? `**Label:** ${claimLabel}` : '',
      '',
      claimSourceText
        ? '**Source passage:**\n\n' + claimSourceText.split(/\r?\n/).map((l) => `> ${l}`).join('\n')
        : '',
    ].filter(Boolean).join('\n');

  it('label + source', () => {
    const c = ctx({ claim: { uri: 'urn:claim:1', label: 'L', sourceText: 'a\nb' } });
    expect(renderTemplate(TMPL, c)).toBe(expected('urn:claim:1', 'L', 'a\nb'));
  });
  it('no label, with source', () => {
    const c = ctx({ claim: { uri: 'urn:claim:1', label: '', sourceText: 'a\nb' } });
    expect(renderTemplate(TMPL, c)).toBe(expected('urn:claim:1', '', 'a\nb'));
  });
  it('label, no source', () => {
    const c = ctx({ claim: { uri: 'urn:claim:1', label: 'L', sourceText: '' } });
    expect(renderTemplate(TMPL, c)).toBe(expected('urn:claim:1', 'L', ''));
  });
  it('no label, no source', () => {
    const c = ctx({ claim: { uri: 'urn:claim:1', label: '', sourceText: '' } });
    expect(renderTemplate(TMPL, c)).toBe(expected('urn:claim:1', '', ''));
  });
});

describe('acceptance: explain-like-im note/no-note branches', () => {
  // Mirrors learning/explain-like-im.ts buildSystemPrompt. Real prompt bodies
  // stand in as 'W'/'N' here; the audience phrase becomes the param VALUE in
  // the migrated skill (option value = phrase), so {{param.audience}} is the
  // phrase directly.
  const TMPL =
    '{{#if note}}W\n\nAudience: {{param.audience}}.\n\n## Note{{#if note.title}} — {{note.title}}{{/if}}\n\n{{note.content}}{{else}}N\n\nAudience: {{param.audience}}.{{/if}}';

  const expected = (content: string | null, title: string, phrase: string): string => {
    if (!content) return `N\n\nAudience: ${phrase}.`;
    const noteBlock = `\n\n## Note${title ? ` — ${title}` : ''}\n\n${content}`;
    return `W\n\nAudience: ${phrase}.${noteBlock}`;
  };

  it('no note → clarifying variant', () => {
    expect(renderTemplate(TMPL, ctx({ param: { audience: 'a curious 8-year-old' } })))
      .toBe(expected(null, '', 'a curious 8-year-old'));
  });
  it('note with title', () => {
    const c = ctx({ note: { content: 'BODY', title: 'My Note', path: 'p' }, param: { audience: 'an expert in an adjacent field' } });
    expect(renderTemplate(TMPL, c)).toBe(expected('BODY', 'My Note', 'an expert in an adjacent field'));
  });
  it('note without title', () => {
    const c = ctx({ note: { content: 'BODY', title: '', path: 'p' }, param: { audience: 'a bright high schooler' } });
    expect(renderTemplate(TMPL, c)).toBe(expected('BODY', '', 'a bright high schooler'));
  });
});
