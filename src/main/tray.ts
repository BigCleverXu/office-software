import { existsSync } from 'node:fs'
import { Menu, nativeImage, Tray } from 'electron'

export interface TrayOptions {
  showWindow: () => void
  quit: () => void
  iconPath?: string
}

/** 创建系统托盘；调用方需保持返回实例的引用以避免被 GC */
export function createTray(options: TrayOptions): Tray {
  const { showWindow, quit, iconPath } = options

  let icon = nativeImage.createEmpty()
  if (iconPath && existsSync(iconPath)) {
    const loaded = nativeImage.createFromPath(iconPath)
    if (!loaded.isEmpty()) {
      icon = loaded
    }
  }

  const tray = new Tray(icon)
  tray.setToolTip('定时提醒')

  const menu = Menu.buildFromTemplate([
    { label: '显示主窗口', click: () => showWindow() },
    { type: 'separator' },
    { label: '退出', click: () => quit() }
  ])
  tray.setContextMenu(menu)

  tray.on('click', () => showWindow())

  return tray
}
