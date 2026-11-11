// 主进程积存金 IPC：读取状态、更新持仓、手动刷新，并向窗口广播状态
import { ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import {
  GOLD_CHANNELS,
  type GoldHolding,
  type GoldState
} from '../../shared/gold'
import type { GoldScheduler } from '../gold-scheduler'
import type { GoldStore } from '../gold-store'

export interface GoldIpcDeps {
  store: GoldStore
  scheduler: GoldScheduler
  getWindow: () => BrowserWindow | null
}

/**
 * 注册积存金相关的 IPC 通道。
 * 持仓写库成功后把调度器最新快照（持仓为现读）推给渲染进程。
 */
export function registerGoldIpc(deps: GoldIpcDeps): void {
  const { store, scheduler, getWindow } = deps

  const buildState = (): GoldState => ({ snapshot: scheduler.getSnapshot() })

  const broadcast = (): void => {
    getWindow()?.webContents.send(GOLD_CHANNELS.stateChanged, buildState())
  }

  ipcMain.handle(GOLD_CHANNELS.getState, () => buildState())

  ipcMain.handle(
    GOLD_CHANNELS.updateHolding,
    (
      _event: Electron.IpcMainInvokeEvent,
      holding: unknown
    ): GoldHolding | null => {
      const updated = store.updateHolding(holding)
      if (!updated) {
        return null
      }
      broadcast()
      return updated
    }
  )

  ipcMain.handle(GOLD_CHANNELS.refreshNow, async () => {
    await scheduler.refreshNow()
  })
}
