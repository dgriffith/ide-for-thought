/**
 * A hierarchy of notes for the `:::mindmap` block (#2966): out from a focus
 * along a parent property, a frontmatter link or the argument relations; to
 * a depth (what's past it counted); a note under several parents drawn under
 * each, marked; a cycle stopped where it comes round; `direction: out`.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { indexAllNotes, mindmapWalk } from '../../../src/main/graph/index';
import type { ProjectContext } from '../../../src/main/project-context-types';
import type { MindmapNoteTree } from '../../../src/shared/mindmap/note-hierarchy';
import { useGraphProject } from '../../helpers/temp-project';

const project = useGraphProject('mindmap-walk-');
let ctx: ProjectContext;
beforeEach(() => { ctx = project.ctx; });
const write = (rel: string, content: string) => {
  fs.mkdirSync(path.dirname(path.join(project.root, rel)), { recursive: true });
  fs.writeFileSync(path.join(project.root, rel), content);
};
/** The tree as `label[mark]` lines indented by depth. */
const shape = (n: MindmapNoteTree, d = 0): string[] => [`${'  '.repeat(d)}${n.label}${n.via ? ` <${n.via}>` : ''}${n.mark ? ` [${n.mark}${n.appearances ? ` ×${n.appearances}` : ''}]` : ''}${n.more ? ` (+${n.more})` : ''}`, ...n.children.flatMap((c) => shape(c, d + 1))];

async function seedTasks() {
  write('.minerva/types/task.md', ['---', 'label: Task', 'id: task', 'properties:', '  - name: parent', '    type: link-to-type', '    targetType: task', '---', ''].join('\n'));
  write('Launch.md', '---\ntype: task\n---\n# Launch\n');
  write('Build.md', '---\ntype: task\nparent: "[[Launch]]"\n---\n# Build\n');
  write('Market.md', '---\ntype: task\nparent: "[[Launch]]"\n---\n# Market\n');
  write('Code.md', '---\ntype: task\nparent: "[[Build]]"\n---\n# Code\n');
  write('Test.md', '---\ntype: task\nparent: "[[Build]]"\n---\n# Test\n');
  write('Fix.md', '---\ntype: task\nparent: "[[Test]]"\n---\n# Fix\n');
  await indexAllNotes(ctx);
}

describe('mindmapWalk (#2966)', () => {
  it('a parent property: the notes whose parent is each node, by title, to the depth — what lies past it counted', async () => {
    await seedTasks();
    const { tree, exists, truncated } = await mindmapWalk(ctx, 'Launch.md', { relation: 'parent', depth: 2 });
    expect(exists).toBe(true);
    expect(truncated).toBe(false);
    expect(shape(tree)).toEqual(['Launch', '  Build', '    Code', '    Test (+1)', '  Market']);
    expect(tree.children[0]!.path).toBe('Build.md');
    expect((await mindmapWalk(ctx, 'Launch.md', { relation: 'property:parent', depth: 3 })).tree.children[0]!.children[1]!.children.map((c) => c.label)).toEqual(['Fix']);
  });

  it('direction out: a node\'s children are the notes it links to', async () => {
    await seedTasks();
    const { tree } = await mindmapWalk(ctx, 'Fix.md', { relation: 'parent', direction: 'out', depth: 6 });
    expect(shape(tree)).toEqual(['Fix', '  Test', '    Build', '      Launch']);
  });

  it('a note under several parents is drawn under each, marked; a cycle stops where it comes round', async () => {
    write('Root.md', '# Root\n');
    write('A.md', '---\ndecomposes: "[[Root]]"\n---\n# A\n');
    write('B.md', '---\ndecomposes: "[[Root]]"\n---\n# B\n');
    write('Shared.md', '---\ndecomposes:\n  - "[[A]]"\n  - "[[B]]"\n---\n# Shared\n');
    write('Loop1.md', '---\ndecomposes: "[[Loop2]]"\n---\n# Loop1\n');
    write('Loop2.md', '---\ndecomposes: "[[Loop1]]"\n---\n# Loop2\n');
    await indexAllNotes(ctx);
    expect(shape((await mindmapWalk(ctx, 'Root.md', { relation: 'decomposes', depth: 4 })).tree))
      .toEqual(['Root', '  A', '    Shared [shared ×2]', '  B', '    Shared [shared ×2]']);
    expect(shape((await mindmapWalk(ctx, 'Loop1.md', { relation: 'decomposes', depth: 5 })).tree))
      .toEqual(['Loop1 [shared ×2]', '  Loop2', '    Loop1 [cycle ×2]']);
  });

  it('an argument: the claims that bear on each one, each with the relation that joins it', async () => {
    write('claims/Big.md', '---\ntype: claim\n---\n# Big claim\n');
    write('claims/For.md', '---\ntype: claim\nsupports: "[[Big]]"\n---\n# A reason for\n');
    write('claims/Against.md', '# Against\n\n[[rebuts::Big]]\n');
    write('claims/Deeper.md', '---\ntype: claim\nsupports: "[[For]]"\n---\n# A reason for the reason\n');
    await indexAllNotes(ctx);
    expect(shape((await mindmapWalk(ctx, 'claims/Big.md', { relation: 'argument', depth: 3 })).tree))
      .toEqual(['Big claim', '  A reason for <Supports>', '    A reason for the reason <Supports>', '  Against <Rebuts>']);
  });

  it('a focus the graph doesn\'t know is just itself, and says so', async () => {
    await seedTasks();
    expect(await mindmapWalk(ctx, 'Nowhere.md', { relation: 'parent' })).toMatchObject({ exists: false, tree: { label: 'Nowhere', children: [] } });
  });
});
