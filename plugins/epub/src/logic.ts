/**
 * The EPUB plugin's logic (#2648), run in its worker host (#2830): the
 * handler its exporter names. It is handed the notes Minerva rendered and
 * returns the book as bytes; Minerva writes it into the folder the user
 * chose. It reads and writes nothing itself.
 */
import { connect } from '/@minerva/plugin-api.js';
import { packEpub } from './pack';
import type { PluginExportPlan } from '../../../src/shared/plugins/format';

const minerva = await connect();

minerva.handle('writeEpub', (args) => packEpub(args as PluginExportPlan));
