/**
 * A sample thoughtbase of Events for testing the Timeline and Calendar
 * layouts by hand (`pnpm sample:events <dir>`). Pure: `eventsThoughtbase(today)`
 * returns `{ relativePath: content }`, and the CLI writes it.
 *
 * Dates are relative to `today`, so the calendar's current month is always
 * the busy one: a crowded day, timed events, bars across a week and a month
 * boundary, month- and year-only dates, a time with a UTC offset, an ignored
 * end, an unreadable date and an undated note. `history/` spans 753 BC to
 * 2017 for zooming the timeline, `projects/` fills a Kanban board (Project's
 * `status` is a choice field; Event has none, so it gets no board), and
 * `Views/` holds saved views of each kind.
 * `Start Here.md` says what to look for in each.
 */

const pad = (n, w = 2) => String(n).padStart(w, '0');

/** A calendar day as plain numbers; month is 1-12. Arithmetic goes through UTC so no zone shifts it. */
function day(y, m, d) {
  const t = new Date(Date.UTC(y, m - 1, d));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), dow: t.getUTCDay() };
}
const addDays = (x, n) => day(x.y, x.m, x.d + n);
const ymd = (x) => `${x.y}-${pad(x.m)}-${pad(x.d)}`;
const ym = (x) => `${x.y}-${pad(x.m)}`;

function note(fields, title, body = '') {
  const fm = Object.entries(fields)
    .filter(([, v]) => v !== undefined)
    // Quoted when YAML would read it as something else: a link, a time, a
    // signed or bare year (a number to YAML), so every date stays a string.
    .map(([k, v]) => `${k}: ${/^\[\[|[:#]|^-?\d/.test(String(v)) ? JSON.stringify(String(v)) : v}`)
    .join('\n');
  return `---\n${fm}\n---\n# ${title}\n${body ? `\n${body}\n` : ''}`;
}

const view = (spec) => `\`\`\`object-view\n${JSON.stringify(spec, null, 2)}\n\`\`\``;

/** @param {Date} today */
export function eventsThoughtbase(today) {
  const t = day(today.getFullYear(), today.getMonth() + 1, today.getDate());
  const first = day(t.y, t.m, 1);
  const last = day(t.y, t.m + 1, 0);
  const next = day(t.y, t.m + 1, 1);
  const prevLast = addDays(first, -1);
  // A Thursday-to-Monday bar crosses a week row whether weeks start on
  // Saturday, Sunday or Monday.
  let thu = day(t.y, t.m, 8);
  while (thu.dow !== 4) thu = addDays(thu, 1);
  const busy = addDays(t, t.d + 2 <= last.d ? 2 : -2);
  const files = {};
  const ev = (path, fields, title, body) => { files[path] = note({ type: fields.type ?? 'event', ...fields }, title, body); };

  // People and places the events link to.
  files['people/Ada Park.md'] = note({ type: 'person', role: 'Engineering lead', organization: 'Minerva' }, 'Ada Park');
  files['people/Ben Okafor.md'] = note({ type: 'person', role: 'Designer', organization: 'Minerva' }, 'Ben Okafor');
  files['people/Chen Wei.md'] = note({ type: 'person', role: 'Product', organization: 'Minerva' }, 'Chen Wei');
  files['places/Lisbon Office.md'] = note({ type: 'place', location: '38.7223,-9.1393', address: 'Rua Augusta, Lisbon' }, 'Lisbon Office');
  files['places/Convention Centre.md'] = note({ type: 'place', location: '52.5200,13.4050', address: 'Berlin' }, 'Convention Centre');

  // Today: three timed events, out of order on disk, to check they sort by time.
  ev('events/Design Review.md', { type: 'meeting', date: `${ymd(t)}T14:30`, organizer: '[[Ben Okafor]]', attendees: '[[Chen Wei]]' }, 'Design Review', 'Second timed event today; should sit after Lunch.');
  ev('events/Team Standup.md', { type: 'meeting', date: `${ymd(t)}T09:30`, end: `${ymd(t)}T09:45`, organizer: '[[Ada Park]]' }, 'Team Standup', 'First of today\'s events.');
  ev('events/Lunch with Ben.md', { date: `${ymd(t)}T12:00`, attendees: '[[Ben Okafor]]' }, 'Lunch with Ben');

  // A crowded day: more than a cell holds, so it ends with "+N more".
  const crowd = [['08:00', 'Coffee Chat'], ['10:00', 'Code Review'], ['11:00', 'One-on-One'], ['12:30', 'Lunch and Learn'], ['15:00', 'Sprint Planning'], ['16:30', 'Vendor Call'], ['18:00', 'Team Drinks']];
  for (const [time, title] of crowd) ev(`events/busy/${title}.md`, { date: `${ymd(busy)}T${time}` }, title);

  // Bars.
  ev('events/Lisbon Offsite.md', { date: ymd(thu), end: ymd(addDays(thu, 4)), location: '[[Lisbon Office]]' }, 'Lisbon Offsite', 'Thursday to Monday: the bar breaks across a week row, marked ‹ ›. Drag it to move all five days.');
  ev('events/Conference.md', { date: ymd(addDays(last, -1)), end: ymd(addDays(next, 1)), location: '[[Convention Centre]]' }, 'Conference', 'Runs from the second-last day of this month into next month.');
  ev('events/Moving Weekend.md', { date: ymd(prevLast), end: ymd(addDays(prevLast, 1)) }, 'Moving Weekend', 'Starts on the last day of last month: on a dimmed day of this page.');

  // Coarse dates: bands above the grid, hatched on the timeline.
  ev('events/Quarterly Planning.md', { date: ym(t) }, 'Quarterly Planning', 'Month only: in the "no day" band, can\'t be dragged.');
  ev('events/Annual Retreat.md', { date: String(t.y) }, 'Annual Retreat', 'Year only: in the "no month" band on every page of the year.');
  ev('events/Product Launch.md', { date: ymd(day(t.y, t.m, 20)), end: ym(next) }, 'Product Launch', 'Exact start, month-only end: the end is hatched, and moving it is refused with a reason.');

  // Times with an offset: fixed moments shown in your own zone.
  ev('events/Evening Call with SF.md', { date: `${ymd(day(t.y, t.m, 6))}T23:30-07:00` }, 'Evening Call with SF', 'Written at 23:30 in California: east of there it lands on the next day, and the preview says "Written as …".');
  ev('events/Release Cut.md', { date: `${ymd(day(t.y, t.m, 9))}T16:00Z` }, 'Release Cut', 'A UTC time.');

  // Things that can't be placed, or are placed with a caveat.
  ev('events/Backwards Workshop.md', { date: ymd(day(t.y, t.m, 15)), end: ymd(day(t.y, t.m, 13)) }, 'Backwards Workshop', 'Its end is before its date: drawn on the 15th as a single day, with the end flagged in the preview.');
  ev('events/Typo Date.md', { date: `${t.y}-02-30` }, 'Typo Date', 'February 30th: in the Undated tray, "couldn\'t be read".');
  ev('events/Someday Hike.md', {}, 'Someday Hike', 'No date at all: in the Undated tray.');

  // Next month, to page to.
  ev('events/Dentist.md', { date: `${ymd(day(next.y, next.m, 12))}T08:15` }, 'Dentist');
  ev('events/Holiday.md', { date: ymd(day(next.y, next.m, 22)), end: ymd(day(next.y, next.m, 29)) }, 'Holiday');

  // History, for zooming out.
  const hist = [
    ['Founding of Rome', { date: '-0752-04-21' }, 'Traditional date, 753 BC.'],
    ['Ides of March', { date: '-0043-03-15' }, '44 BC: the axis and preview read "Mar 15, 44 BC".'],
    ['Reign of Augustus', { date: '-0026-01-16', end: '0014-08-19' }, 'A bar across the BC/AD boundary.'],
    ['Printing Press', { date: '1450' }, 'Year only: a hatched stretch.'],
    ['Apollo 11', { date: '1969-07-16', end: '1969-07-24' }, ''],
    ['Moon Landing', { date: '1969-07-20T20:17Z' }, 'A moment inside the Apollo 11 bar.'],
    ['Woodstock', { date: '1969-08-15', end: '1969-08-18' }, ''],
    ['Fall of the Berlin Wall', { date: '1989-11-09' }, ''],
    ['Cassini Mission', { date: '1997-10-15', end: '2017-09-15' }, 'Twenty years long.'],
    ['Big Bang', { date: '-13800000000' }, 'Too far back for a timeline to draw: in the Undated tray, with the reason.'],
  ];
  for (const [title, fields, body] of hist) ev(`history/${title}.md`, fields, title, body);

  // Projects, for the Kanban board: every status, one typed by hand that
  // isn't a choice (its own column), and one with none (No value). Their
  // `started` dates also give Project a timeline and calendar.
  const projects = [
    ['Website Redesign', 'active', addDays(first, -20), '[[Ada Park]]'],
    ['Mobile App', 'active', addDays(t, -14), '[[Ben Okafor]]'],
    ['Data Migration', 'paused', addDays(first, -45), '[[Chen Wei]]'],
    ['Onboarding Revamp', 'done', addDays(first, -90), '[[Ben Okafor]]'],
    ['Quarterly Report', 'done', addDays(first, -30), '[[Chen Wei]]'],
    ['Blockchain Pilot', 'abandoned', addDays(first, -120), '[[Ada Park]]'],
    ['Vendor Integration', 'blocked', addDays(t, -5), '[[Ada Park]]'],
    ['Office Move', undefined, addDays(t, 3), undefined],
  ];
  for (const [title, status, started, owner] of projects) {
    files[`projects/${title}.md`] = note({ type: 'project', status, started: ymd(started), owner }, title,
      status === 'blocked' ? '"blocked" isn\'t one of Project\'s choices: it gets a column of its own after them.'
        : status === undefined ? 'No status: in the No value column, at the end.' : '');
  }

  // Saved views.
  const views = [
    ['Calendar - This Month', { typeId: 'event', layout: 'calendar' }, 'No month saved: always opens on the current one.'],
    ['Calendar - Next Month', { typeId: 'event', layout: 'calendar', month: ym(next) }, 'Opens on next month.'],
    ['Calendar - Meetings Only', { typeId: 'event', layout: 'calendar', filters: [{ property: 'type', values: ['meeting'] }] }, 'A subtype filter: just Team Standup and Design Review.'],
    ['Timeline - Everything', { typeId: 'event', layout: 'timeline' }, 'Fitted to every dated event, 753 BC to now.'],
    ['Timeline - Rome', { typeId: 'event', layout: 'timeline', from: '-0099', to: '0014', folder: 'history' }, 'A saved range, 100 BC to AD 14.'],
    ['Project Board', { typeId: 'project', layout: 'kanban' }, 'Grouped by status: active, paused, done, abandoned, then blocked and No value.'],
    ['Project Board - Done First', { typeId: 'project', layout: 'kanban', groupBy: 'status', columnOrder: ['done', 'active'], showEmptyColumns: false }, 'A saved column order: done and active first, the rest after.'],
    ['Timeline - Around Now', { typeId: 'event', layout: 'timeline', filters: [{ property: 'date', min: ym(prevLast), max: ym(next) }] }, 'A date range filter: Fit stays inside last month to next.'],
  ];
  for (const [title, spec, body] of views) files[`Views/${title}.md`] = `# ${title}\n\n${body}\n\n${view(spec)}\n`;

  files['Start Here.md'] = `# Start Here

A sample thoughtbase for trying the Timeline and Calendar layouts by hand. Its
dates were generated relative to ${ymd(t)}; regenerate it with
\`pnpm sample:events <dir>\` to move them to a new month.

Open **Objects → Event** and switch between Timeline and Calendar, or open
the notes in \`Views/\` for saved views. Each event's note says what it's for.

## Calendar, this month

- **Today**: Team Standup 09:30, Lunch with Ben 12:00, Design Review 14:30, in that order.
- **${ymd(busy)}**: seven events, so the cell ends with "+N more"; Enter on the day opens the list.
- **Lisbon Offsite** (${ymd(thu)} to ${ymd(addDays(thu, 4))}): a bar broken across a week row.
- **Conference**: runs into next month. **Moving Weekend** starts on a dimmed day from last month.
- **Bands**: Quarterly Planning (month only) and Annual Retreat (year only) above the grid.
- **Product Launch**: month-only end, hatched; dragging it is refused with a reason.
- **Evening Call with SF**: 23:30 at UTC−7, on the 7th for most of the world, with "Written as …".
- **Backwards Workshop**: end before date, drawn on the 15th alone.
- **Undated tray**: Typo Date (unreadable), Someday Hike (no date).
- Drag an event, ⌘Z to take it back; Shift+F10 → Move to date… by keyboard.

## Timeline

- Fit shows 753 BC to next month; zoom into the BC labels and the Augustus bar.
- 1969: the Moon Landing point inside the Apollo 11 bar, Woodstock beside it.
- Printing Press is hatched (year only). Big Bang is in the Undated tray, out of range.
- List swaps the drawing for a list with the same order and "(approximate)" marks.

## Kanban

Kanban is offered only for a type with a choice (enum) field, so Events get
none. Open **Objects → Project** and switch to Kanban, or the \`Project Board\`
notes in \`Views/\`.

- Columns: active (2), paused (1), done (2), abandoned (1), then **blocked**
  (Vendor Integration, a value typed by hand) and **No value** (Office Move).
- Drag a card to another column and its \`status\` line changes; ⌘Z takes it back.
- Shift+F10 → Move to ▸ by keyboard; ⌘-click several cards to move them together.
- Drag a column header, or its ⋯ menu, to reorder; toggle Show empty columns.

## Settings worth flipping

- Settings → Appearance → Week starts on, and Show week numbers.
- Settings → Plugins → turn Kanban, Timeline or Calendar off: the layout goes, saved views show a table.
`;

  return files;
}
