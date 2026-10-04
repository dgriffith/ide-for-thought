import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import type { ChannelMap } from '../../shared/ipc-contract';
import { assertTrustedIpcSender } from './sender-guard';

/** Typed `ipcMain.handle`: the handler's args + return are checked against the ChannelMap.
 *  Every call is refused unless it comes from the renderer's own main frame (#2553). */
export function handle<K extends keyof ChannelMap>(
  channel: K,
  handler: (event: IpcMainInvokeEvent, ...args: Parameters<ChannelMap[K]>) =>
    Awaited<ReturnType<ChannelMap[K]>> | Promise<Awaited<ReturnType<ChannelMap[K]>>>,
): void {
  const run = handler as (e: IpcMainInvokeEvent, ...a: unknown[]) => unknown;
  ipcMain.handle(channel, (event, ...args: unknown[]) => {
    assertTrustedIpcSender(channel, event);
    return run(event, ...args);
  });
}
