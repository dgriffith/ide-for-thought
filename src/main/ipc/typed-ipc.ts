import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import type { ChannelMap } from '../../shared/ipc-contract';

/** Typed `ipcMain.handle`: the handler's args + return are checked against the ChannelMap. */
export function handle<K extends keyof ChannelMap>(
  channel: K,
  handler: (event: IpcMainInvokeEvent, ...args: Parameters<ChannelMap[K]>) =>
    Awaited<ReturnType<ChannelMap[K]>> | Promise<Awaited<ReturnType<ChannelMap[K]>>>,
): void {
  ipcMain.handle(channel, handler as (e: IpcMainInvokeEvent, ...a: unknown[]) => unknown);
}
