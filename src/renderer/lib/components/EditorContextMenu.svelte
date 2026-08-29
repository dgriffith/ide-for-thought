<script lang="ts">
  // The editor's right-click context menu, extracted from Editor.svelte (#1625).
  // Presentational: it renders the menu tree and dispatches through the handlers
  // the parent passes — editor-internal commands (exec / runCmd / block-link /
  // link open+edit / submenu-clamp / menu lifecycle) plus the grouped `ops`
  // object of host forwarders. It owns no editor state; `menu` is the parent's
  // reactive menu model and `menuEl` binds back so the parent's viewport-clamp
  // effect can read this element.
  import type { EditorView } from '@codemirror/view';
  import Icon from './Icon.svelte';
  import { api } from '../ipc/client';
  import { voiceSettings } from '../voice/voice-settings.svelte';
  import {
    toggleBold, toggleItalic, toggleCode, toggleStrikethrough, toggleHighlight,
    toggleH1, toggleH2, toggleH3, toggleQuote, toggleBulletList, toggleNumberedList,
    insertTable, insertHorizontalRule, insertFootnote, insertLink, insertImage,
    insertWikiLink, insertTypedLinks, insertCallouts, insertCardCallout,
    insertSparqlQuery, insertSqlQuery, insertPythonScript, insertMermaidDiagram,
    insertYouTubeEmbed, vegaLiteInserts,
  } from '../editor/formatting';
  import { toolRequiresSelection, type ThinkingToolInfo } from '../../../shared/tools/types';
  import type { LinkRange } from '../editor/link-decorations';
  import type {
    EditorContextMenuState,
    EditorMenuOps,
    EditorToolMenu,
  } from '../editor/context-menu-ops';

  interface Props {
    /** The open-menu model (position + what was clicked). */
    menu: EditorContextMenuState;
    /** Bound back to the parent so its viewport-clamp effect can measure. */
    menuEl?: HTMLDivElement | undefined;
    /** Path of the note being edited — gates block-link + open-in items. */
    filePath: string;
    /** Tools-for-Thought submenus (Learning / Research / Analysis). */
    toolMenus: EditorToolMenu[];
    /** Grouped host forwarders — see EditorMenuOps. */
    ops: EditorMenuOps;
    /** Run a `document.execCommand` (cut / copy / paste / selectAll). */
    onExec: (cmd: string) => void;
    /** Run a CodeMirror command against the editor view. */
    onRunCmd: (cmd: (v: EditorView) => boolean) => void;
    onCopyBlockLink: () => void;
    onOpenLink: (link: LinkRange) => void;
    onEditLink: (link: LinkRange) => void;
    /** onmouseenter on a submenu trigger — reflow it inside the viewport. */
    onAdjustSubmenu: (event: MouseEvent) => void;
    /** Restore selection + close the menu, then run the action. */
    onMenuAction: (action: () => void) => void;
    onClose: () => void;
    /** Toggle editor dictation (needs the view, so the parent supplies it). */
    onDictate: () => void;
  }

  let {
    menu,
    menuEl = $bindable(),
    filePath,
    toolMenus,
    ops,
    onExec,
    onRunCmd,
    onCopyBlockLink,
    onOpenLink,
    onEditLink,
    onAdjustSubmenu,
    onMenuAction,
    onClose,
    onDictate,
  }: Props = $props();
</script>

{#snippet toolButton(tool: ThinkingToolInfo)}
  {@const needsSelection = toolRequiresSelection(tool) && !menu.hasSelection}
  {@const needsClaim = (tool.context?.includes('claimUnderCursor') ?? false) && !menu.claimUri}
  <button
    onclick={() => onMenuAction(() => ops.invokeTool?.(tool.id))}
    disabled={needsSelection || needsClaim}
    title={needsClaim
      ? 'Right-click on a line containing a claim URI'
      : needsSelection
        ? 'Select text first'
        : tool.description}
  >{tool.name}</button>
{/snippet}

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="context-menu"
  bind:this={menuEl}
  style:left="{menu.x}px"
  style:top="{menu.y}px"
  onmousedown={(e) => e.preventDefault()}
>
  {#if menu.link}
    <button onclick={() => onOpenLink(menu.link!)}>Open Link</button>
    <button onclick={() => onEditLink(menu.link!)}>Edit Link</button>
    <div class="separator"></div>
  {/if}
  <button onclick={() => onExec('cut')}>Cut</button>
  <button onclick={() => onExec('copy')}>Copy</button>
  <button onclick={() => onExec('paste')}>Paste</button>
  {#if filePath}
    <button onclick={() => onCopyBlockLink()}>Copy Block Link</button>
  {/if}
  <div class="separator"></div>
  <div class="submenu-item" onmouseenter={onAdjustSubmenu}>
    <span class="submenu-trigger">Highlight<Icon name="chevronRight" size={10} /></span>
    <div class="submenu">
      <button onclick={() => onRunCmd(toggleHighlight)}>Colored Highlight</button>
      <button onclick={() => onRunCmd(toggleBold)}>Bold</button>
      <button onclick={() => onRunCmd(toggleItalic)}>Italic</button>
      <button onclick={() => onRunCmd(toggleCode)}>Code</button>
      <button onclick={() => onRunCmd(toggleStrikethrough)}>Strikethrough</button>
    </div>
  </div>
  <div class="submenu-item" onmouseenter={onAdjustSubmenu}>
    <span class="submenu-trigger">Link<Icon name="chevronRight" size={10} /></span>
    <div class="submenu">
      <button onclick={() => onRunCmd(insertWikiLink)}>Wiki Link</button>
      <button onclick={() => onRunCmd(insertLink)}>URL Link</button>
      <div class="submenu-item" onmouseenter={onAdjustSubmenu}>
        <span class="submenu-trigger">Typed Link...<Icon name="chevronRight" size={10} /></span>
        <div class="submenu">
          {#each insertTypedLinks as { linkType, command }}
            <button onclick={() => onRunCmd(command)}>
              <span class="typed-link-dot" style:background={linkType.color}></span>
              {linkType.label} Link
            </button>
          {/each}
        </div>
      </div>
      <div class="submenu-separator"></div>
      <button onclick={() => onRunCmd(insertFootnote)}>Footnote</button>
    </div>
  </div>
  <div class="submenu-item" onmouseenter={onAdjustSubmenu}>
    <span class="submenu-trigger">Paragraph<Icon name="chevronRight" size={10} /></span>
    <div class="submenu">
      <button onclick={() => onRunCmd(toggleH1)}>Heading 1</button>
      <button onclick={() => onRunCmd(toggleH2)}>Heading 2</button>
      <button onclick={() => onRunCmd(toggleH3)}>Heading 3</button>
      <div class="submenu-separator"></div>
      <button onclick={() => onRunCmd(toggleQuote)}>Quote</button>
      <div class="submenu-item" onmouseenter={onAdjustSubmenu}>
        <span class="submenu-trigger">Callout...<Icon name="chevronRight" size={10} /></span>
        <div class="submenu">
          {#each insertCallouts as { label, command }}
            <button onclick={() => onRunCmd(command)}>{label}</button>
          {/each}
        </div>
      </div>
      <button onclick={() => onRunCmd(insertHorizontalRule)}>Horizontal Rule</button>
    </div>
  </div>
  <div class="submenu-item" onmouseenter={onAdjustSubmenu}>
    <span class="submenu-trigger">Elements<Icon name="chevronRight" size={10} /></span>
    <div class="submenu">
      <button onclick={() => onRunCmd(insertTable)}>Table</button>
      <button onclick={() => onRunCmd(insertImage)}>Image</button>
      <button onclick={() => onRunCmd(toggleBulletList)}>Bulleted List</button>
      <button onclick={() => onRunCmd(toggleNumberedList)}>Numbered List</button>
      <div class="submenu-separator"></div>
      <div class="submenu-item" onmouseenter={onAdjustSubmenu}>
        <span class="submenu-trigger">Query...<Icon name="chevronRight" size={10} /></span>
        <div class="submenu">
          <button onclick={() => onRunCmd(insertSqlQuery)}>SQL</button>
          <button onclick={() => onRunCmd(insertSparqlQuery)}>SPARQL</button>
        </div>
      </div>
      <button onclick={() => onRunCmd(insertPythonScript)}>Python Script</button>
      <button onclick={() => onRunCmd(insertMermaidDiagram)}>Mermaid Diagram</button>
      <button onclick={() => onRunCmd(insertYouTubeEmbed)}>YouTube Video</button>
      <button onclick={() => onRunCmd(insertCardCallout)}>Flashcard</button>
      <div class="submenu-item" onmouseenter={onAdjustSubmenu}>
        <span class="submenu-trigger">Chart...<Icon name="chevronRight" size={10} /></span>
        <div class="submenu">
          {#each vegaLiteInserts as t (t.label)}
            <button onclick={() => onRunCmd(t.command)}>{t.label}</button>
          {/each}
        </div>
      </div>
      <div class="submenu-separator"></div>
      <button onclick={() => onMenuAction(() => ops.insertQueryList?.())}>Link List for Tag...</button>
    </div>
  </div>
  {#if ops.invokeTool && toolMenus.length > 0}
    <div class="separator"></div>
    {#each toolMenus as menu (menu.id)}
      <div class="submenu-item" onmouseenter={onAdjustSubmenu}>
        <span class="submenu-trigger">{menu.label}<Icon name="chevronRight" size={10} /></span>
        <div class="submenu">
          <!-- Named groups nest into submenus; ungrouped skills stay inline
               (like the Source tools menu) rather than being swept into a
               "General" bucket, so adding a group to one skill is a local
               change, not a menu-wide restructure. -->
          {#each menu.groups as group (group.label ?? '__ungrouped__')}
            {#if group.label}
              <div class="submenu-item" onmouseenter={onAdjustSubmenu}>
                <span class="submenu-trigger">{group.label}<Icon name="chevronRight" size={10} /></span>
                <div class="submenu">
                  {#each group.tools as tool (tool.id)}{@render toolButton(tool)}{/each}
                </div>
              </div>
            {:else}
              {#each group.tools as tool (tool.id)}{@render toolButton(tool)}{/each}
            {/if}
          {/each}
        </div>
      </div>
    {/each}
  {/if}
  {#if ops.addTagCurrentNote || ops.removeTagCurrentNote || ops.addPropertyCurrentNote || ops.removePropertyCurrentNote}
    <div class="separator"></div>
    <div class="submenu-item" onmouseenter={onAdjustSubmenu}>
      <span class="submenu-trigger">Metadata<Icon name="chevronRight" size={10} /></span>
      <div class="submenu">
        {#if ops.addTagCurrentNote}
          <button onclick={() => onMenuAction(() => ops.addTagCurrentNote?.())}>Add Tag&hellip;</button>
        {/if}
        {#if ops.removeTagCurrentNote}
          <button onclick={() => onMenuAction(() => ops.removeTagCurrentNote?.())}>Remove Tag&hellip;</button>
        {/if}
        {#if ops.addPropertyCurrentNote}
          <button onclick={() => onMenuAction(() => ops.addPropertyCurrentNote?.())}>Add Property&hellip;</button>
        {/if}
        {#if ops.removePropertyCurrentNote}
          <button onclick={() => onMenuAction(() => ops.removePropertyCurrentNote?.())}>Remove Property&hellip;</button>
        {/if}
      </div>
    </div>
  {/if}
  <div class="separator"></div>
  {#if ops.extractSelection || ops.splitHere || ops.splitByHeading || ops.rename || ops.move || ops.copyFile || ops.merge || ops.autoTag || ops.autoLink || ops.autoLinkInbound}
    <div class="submenu-item" onmouseenter={onAdjustSubmenu}>
      <span class="submenu-trigger">Refactor<Icon name="chevronRight" size={10} /></span>
      <div class="submenu">
        {#if ops.rename}
          <button onclick={() => onMenuAction(() => ops.rename?.())}>Rename&hellip;</button>
        {/if}
        {#if ops.move}
          <button onclick={() => onMenuAction(() => ops.move?.())}>Move&hellip;</button>
        {/if}
        {#if ops.copyFile}
          <button onclick={() => onMenuAction(() => ops.copyFile?.())}>Copy&hellip;</button>
        {/if}
        {#if ops.merge}
          <button onclick={() => onMenuAction(() => ops.merge?.())}>Merge into&hellip;</button>
        {/if}
        {#if ops.rename || ops.move || ops.copyFile || ops.merge}
          <div class="separator"></div>
        {/if}
        {#if ops.extractSelection}
          <button
            onclick={() => onMenuAction(() => ops.extractSelection?.())}
            disabled={!menu.hasSelection}
          >Extract Selection to New Note</button>
        {/if}
        {#if ops.splitHere}
          <button onclick={() => onMenuAction(() => ops.splitHere?.())}>Split Note Here</button>
        {/if}
        {#if ops.splitByHeading}
          <button onclick={() => onMenuAction(() => ops.splitByHeading?.())}>Split by Heading&hellip;</button>
        {/if}
        {#if ops.autoTag || ops.autoLink || ops.autoLinkInbound}
          {#if ops.extractSelection || ops.splitHere || ops.splitByHeading}
            <div class="separator"></div>
          {/if}
          {#if ops.autoTag}
            <button onclick={() => onMenuAction(() => ops.autoTag?.())}>Auto-tag</button>
          {/if}
          {#if ops.autoLink}
            <button onclick={() => onMenuAction(() => ops.autoLink?.())}>Auto-link outbound&hellip;</button>
          {/if}
          {#if ops.autoLinkInbound}
            <button onclick={() => onMenuAction(() => ops.autoLinkInbound?.())}>Auto-link inbound&hellip;</button>
          {/if}
        {/if}
        {#if ops.formatCurrentNote}
          <div class="separator"></div>
          <button onclick={() => onMenuAction(() => ops.formatCurrentNote?.())}>Format Note</button>
        {/if}
      </div>
    </div>
    <div class="separator"></div>
  {/if}
  <button onclick={() => onMenuAction(() => ops.openConversation?.())}>Ask About This...</button>
  {#if voiceSettings.enabled}
    <button onclick={() => onMenuAction(onDictate)}>Dictate…</button>
  {/if}
  <button onclick={() => onMenuAction(() => ops.bookmark?.())}>Bookmark This Note</button>
  {#if ops.bookmarkSection}
    <button onclick={() => onMenuAction(() => ops.bookmarkSection?.())}>Bookmark Section</button>
  {/if}
  {#if ops.bookmarkLine}
    <button onclick={() => onMenuAction(() => ops.bookmarkLine?.())}>Bookmark Line</button>
  {/if}
  <div class="separator"></div>
  <div class="submenu-item" onmouseenter={onAdjustSubmenu}>
    <span class="submenu-trigger">Open In<Icon name="chevronRight" size={10} /></span>
    <div class="submenu">
      <button onclick={() => { void api.shell.revealFile(filePath); onClose(); }}>Reveal in Finder</button>
      <button onclick={() => { void api.shell.openInDefault(filePath); onClose(); }}>Open in Default App</button>
      <button onclick={() => { void api.shell.openInTerminal(filePath); onClose(); }}>Open in Terminal</button>
    </div>
  </div>
  <div class="separator"></div>
  <button onclick={() => onExec('selectAll')}>Select All</button>
</div>

<style>
  /* Base menu chrome — duplicated with Editor.svelte's gutter menu (which also
     wears `.context-menu`); scoped styles don't cross the component boundary. */
  /* Base shape shared via .context-menu in global.css (#1910); only the
     per-instance min-width stays local. */
  .context-menu {
    min-width: 160px;
  }

  .context-menu button {
    display: block;
    width: 100%;
    padding: 6px 12px;
    border: none;
    background: none;
    color: var(--text);
    font-size: 12px;
    cursor: pointer;
    text-align: left;
  }

  .context-menu button:hover {
    background: var(--bg-button);
  }

  .submenu-item {
    position: relative;
  }

  .submenu-trigger {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 6px 12px;
    font-size: 12px;
    color: var(--text);
    cursor: default;
  }

  .submenu-item:hover > .submenu-trigger {
    background: var(--bg-button);
  }

  .submenu {
    display: none;
    position: absolute;
    left: 100%;
    top: -4px;
    background: var(--bg-sidebar);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 4px 0;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    min-width: 150px;
  }

  .submenu-item:hover > .submenu {
    display: block;
  }

  .submenu-separator {
    height: 1px;
    background: var(--border);
    margin: 4px 0;
  }

  .typed-link-dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    margin-right: 4px;
    vertical-align: middle;
  }

  .separator {
    height: 1px;
    background: var(--border);
    margin: 4px 0;
  }
</style>
