import { describe, it, expect } from 'vitest';
import MarkdownIt from 'markdown-it';
import { installMath } from '../../src/renderer/lib/markdown/math-plugin';

function md(): MarkdownIt {
  const m = new MarkdownIt({ html: true });
  installMath(m);
  return m;
}

describe('math-plugin: inline $…$', () => {
  it('renders a simple inline formula as KaTeX output', () => {
    const html = md().render('The sum $a + b$ appears.');
    expect(html).toContain('class="katex"');
    expect(html).toContain('a');
    // Inline math should NOT be wrapped in the display-mode math-block div.
    expect(html).not.toContain('class="math-block"');
  });

  it('renders formulas that start with a digit', () => {
    // Regression test: the earlier digit-after-open heuristic was too
    // aggressive and blocked ranges like "$0.6<z<4$".
    const html = md().render('The range $0.6<z<4$ satisfies.');
    expect(html).toContain('class="katex"');
    expect(html).toContain('0.6');
  });

  it('leaves unpaired dollar amounts alone ("$5 today")', () => {
    const html = md().render('It costs $5 today.');
    expect(html).not.toContain('class="katex"');
    expect(html).toContain('$5');
  });

  it('leaves "$5 today $50 tomorrow" as prose (closing $ before whitespace fails)', () => {
    const html = md().render('$5 today $50 tomorrow');
    expect(html).not.toContain('class="katex"');
  });

  it('does not treat whitespace-adjacent dollars as math delimiters', () => {
    const html = md().render('pay $ today $');
    expect(html).not.toContain('class="katex"');
  });

  it('does not span a newline', () => {
    const html = md().render('open $foo\nbar$ close');
    expect(html).not.toContain('class="katex"');
  });

  it('does not terminate at an escaped \\$ inside the math span', () => {
    // `\$` is not a valid KaTeX construct so the render itself errors,
    // but the important behaviour is that the tokenizer treated the
    // whole `a\$b` as one math span — the output is a single
    // katex-error element, not prose + mistaken code.
    const html = md().render('try $a\\$b$ next');
    expect(html).toContain('katex-error');
    // The trailing " next" must still land as prose inside the same
    // paragraph, proving we found the real closing `$`.
    expect(html).toContain('next</p>');
  });

  it('does not render math inside inline code', () => {
    const html = md().render('code: `$a + b$` back to prose');
    expect(html).not.toContain('class="katex"');
    expect(html).toContain('<code>');
  });
});

describe('math-plugin: block $$…$$', () => {
  it('renders a multi-line block as display math', () => {
    const html = md().render('$$\n\\sum_{i=0}^n i\n$$\n');
    expect(html).toContain('class="math-block"');
    expect(html).toContain('class="katex-display"');
  });

  it('renders a one-liner $$…$$', () => {
    const html = md().render('$$ x^2 $$\n');
    expect(html).toContain('class="math-block"');
    expect(html).toContain('class="katex-display"');
  });

  it('renders inline $$…$$ mid-paragraph as display math', () => {
    // Regression test: the block rule only fires at start-of-line, so
    // mid-paragraph $$…$$ was dropping through neither rule.
    const html = md().render('The range $$0.6<z<4$$ is useful.');
    expect(html).toContain('class="katex"');
    expect(html).toContain('katex-display');
  });

  it('renders inline $$…$$ at start of line (no trailing newline) as display math', () => {
    const html = md().render('$$0.6<z<4$$');
    expect(html).toContain('class="katex"');
  });

  it('does not render math inside a fenced code block', () => {
    const input = '```\n$$x = 1$$\n$ y = 2 $\n```\n';
    const html = md().render(input);
    expect(html).not.toContain('class="katex"');
    expect(html).toContain('<code>');
  });
});

describe('math-plugin: errors', () => {
  it('renders malformed LaTeX as a katex-error span, does not throw', () => {
    const html = md().render('$\\frac{$');
    // KaTeX's throwOnError:false emits an error span with .katex-error.
    // The full preview still renders.
    expect(html).toContain('katex-error');
  });
});
