import { ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import { WEATHER_CHANNELS, type WeatherViewState } from '../../shared/weather'
import type { WeatherService } from '../weather-service'

export interface WeatherIpcDeps {
  service: WeatherService
  getWindow: () => BrowserWindow | null
}

/**
 * 注册天气 IPC 通道。
 *
 * getState / search 只读；其余变更通道完成后把最新状态广播给渲染进程。
 * 参数一律原样透传，服务层内部已把失败收敛为状态 / 错误文案，不抛出。
 */
export function registerWeatherIpc(deps: WeatherIpcDeps): void {
  const { service, getWindow } = deps

  const broadcast = (state: WeatherViewState): void => {
    getWindow()?.webContents.send(WEATHER_CHANNELS.stateChanged, state)
  }

  ipcMain.handle(WEATHER_CHANNELS.getState, (): WeatherViewState =>
    service.getState()
  )

  ipcMain.handle(
    WEATHER_CHANNELS.search,
    (_event: Electron.IpcMainInvokeEvent, keyword: unknown) =>
      service.search(keyword)
  )

  ipcMain.handle(
    WEATHER_CHANNELS.selectCity,
    async (
      _event: Electron.IpcMainInvokeEvent,
      cityId: unknown
    ): Promise<WeatherViewState> => {
      const state = await service.selectCity(cityId)
      broadcast(state)
      return state
    }
  )

  ipcMain.handle(
    WEATHER_CHANNELS.addCity,
    async (
      _event: Electron.IpcMainInvokeEvent,
      city: unknown
    ): Promise<WeatherViewState> => {
      const state = await service.addCity(city)
      broadcast(state)
      return state
    }
  )

  ipcMain.handle(
    WEATHER_CHANNELS.removeCity,
    async (
      _event: Electron.IpcMainInvokeEvent,
      cityId: unknown
    ): Promise<WeatherViewState> => {
      const state = await service.removeCity(cityId)
      broadcast(state)
      return state
    }
  )

  ipcMain.handle(
    WEATHER_CHANNELS.refresh,
    async (): Promise<WeatherViewState> => {
      const state = await service.refresh()
      broadcast(state)
      return state
    }
  )
}
