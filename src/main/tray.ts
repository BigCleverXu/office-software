import { existsSync, readFileSync } from 'node:fs'
import { Menu, nativeImage, Tray } from 'electron'
import type { NativeImage } from 'electron'

/** 托盘图标路径：macOS 使用模板图，其他平台使用彩色小图 */
export interface TrayIconPaths {
  /** Windows / Linux 使用的彩色图标 */
  color: string
  /** macOS 菜单栏模板图标（1x，16×16） */
  template: string
  /** macOS 菜单栏模板图标（2x，32×32，Retina） */
  template2x: string
}

export interface TrayOptions {
  showWindow: () => void
  openMarket: () => void
  quit: () => void
  icons: TrayIconPaths
}

/**
 * 构建 macOS 菜单栏图标：
 * 1x 为基准，附加 2x 表示保证 Retina 清晰；
 * 标记为模板图后由系统按菜单栏明暗自动反色。
 */
function createMacTrayImage(icons: TrayIconPaths): NativeImage {
  const image = existsSync(icons.template)
    ? nativeImage.createFromPath(icons.template)
    : nativeImage.createEmpty()
  if (!image.isEmpty() && existsSync(icons.template2x)) {
    try {
      const png = readFileSync(icons.template2x)
      image.addRepresentation({
        scaleFactor: 2,
        width: 32,
        height: 32,
        dataURL: `data:image/png;base64,${png.toString('base64')}`
      })
    } catch {
      // 2x 读取失败时退回 1x，不影响托盘创建
    }
  }
  image.setTemplateImage(true)
  return image
}

/** 按平台选择托盘图标，加载失败时回退为空图（系统会显示占位） */
function createTrayImage(icons: TrayIconPaths): NativeImage {
  if (process.platform === 'darwin') {
    const template = createMacTrayImage(icons)
    if (!template.isEmpty()) {
      return template
    }
  }
  if (existsSync(icons.color)) {
    const loaded = nativeImage.createFromPath(icons.color)
    if (!loaded.isEmpty()) {
      return loaded
    }
  }
  return nativeImage.createEmpty()
}

/** 创建系统托盘；调用方需保持返回实例的引用以避免被 GC */
export function createTray(options: TrayOptions): Tray {
  const { showWindow, openMarket, quit, icons } = options

  const tray = new Tray(createTrayImage(icons))
  tray.setToolTip('定时提醒')

  const menu = Menu.buildFromTemplate([
    { label: '显示主窗口', click: () => showWindow() },
    { label: '打开行情', click: () => openMarket() },
    { type: 'separator' },
    { label: '退出', click: () => quit() }
  ])
  tray.setContextMenu(menu)

  tray.on('click', () => showWindow())

  return tray
}
