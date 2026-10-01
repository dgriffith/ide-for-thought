/**
 * Bodies the model writes are Markdown: both tools that take one tell it so,
 * and the rules' own example renders the way the rules say it does.
 */
import { describe, it, expect } from 'vitest';
import MarkdownIt from 'markdown-it';
import { MARKDOWN_BODY_RULES } from '../../../../src/main/llm/tools/markdown-body-rules';
import { proposeObjectType } from '../../../../src/main/llm/tools/propose-object-type';
import { proposeNotes } from '../../../../src/main/llm/tools/propose-notes';

const md = new MarkdownIt();

describe('Markdown body rules', () => {
  it('reach the model on both tools that take a body', () => {
    const schema = proposeObjectType.definition.input_schema as { properties: { template: { description: string } } };
    expect(schema.properties.template.description).toContain(MARKDOWN_BODY_RULES);
    expect(proposeNotes.definition.description).toContain(MARKDOWN_BODY_RULES);
  });

  it('explain the failure they prevent: bare consecutive field lines collapse into one paragraph', () => {
    const bad = md.render('**Address:** {{address}}\n**Website:** {{website}}');
    expect(bad.match(/<p>/g)).toHaveLength(1);
  });

  it('give an example that renders one list item per field, and separate headings', () => {
    const example = MARKDOWN_BODY_RULES.split('```\n')[1]!;
    const html = md.render(example);
    expect(html.match(/<li>/g)).toHaveLength(3);
    expect(html).toContain('<h2>Highlights</h2>');
    expect(html).toContain('<h2>Notes</h2>');
  });
});
