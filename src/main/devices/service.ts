// 设备模块：主进程服务层
// 负责并发去重刷新、基线捕获、写操作串行化与跨平台告警聚合
import {
  DEFAULT_MASTER_VOLUME,
  DEVICE_WARNING_MAC_POINTER,
  DEVICE_WARNING_MAC_VOLUME,
  DEVICE_WARNING_UNSUPPORTED,
  clampVolume,
  createEmptyDeviceSnapshot,
  formatDeviceUpdatedLabel,
  isValidPointerSpeed,
  pointerPercentToSpeed,
  type AudioSnapshot,
  type DeviceActionResult,
  type DeviceSnapshot,
  type PointerSnapshot
} from '../../shared/devices'
import type { DeviceBackend } from './backend'

/** 基线：首次成功读取到的系统状态，用于一键还原 */
export interface DeviceBaseline {
  masterVolume: number | null
  masterMuted: boolean
  outputs: Record<string, number>
  pointerSpeed: number | null
}

export interface DeviceServiceOptions {
  backend: DeviceBackend
  onSnapshot: (snapshot: DeviceSnapshot) => void
}

/** 各段读取失败的提示文案（不外泄错误堆栈） */
const WARNING_DEVICES_FAILED = '设备列表读取失败'
const WARNING_AUDIO_FAILED = '音频状态读取失败'
const WARNING_POINTER_FAILED = '指针速度读取失败'

/** 写操作失败文案 */
const ERROR_SERVICE_STOPPED = '设备服务已停止'
const ERROR_INVALID_VOLUME = '音量参数无效'
const ERROR_INVALID_OUTPUT = '输出设备标识无效'
const ERROR_INVALID_MUTED = '静音参数无效'
const ERROR_INVALID_POINTER = '指针速度参数无效'

/** 还原单项失败文案 */
const RESET_MASTER_FAILED = '主音量恢复失败'
const RESET_MUTED_FAILED = '静音状态恢复失败'
const RESET_UNMUTE_FAILED = '取消静音失败'
const RESET_OUTPUT_FAILED = '输出设备音量恢复失败'
const RESET_POINTER_FAILED = '指针速度恢复失败'

/** 追加告警并去重，避免同一文案重复出现 */
function pushWarning(list: string[], warning: string): void {
  if (!list.includes(warning)) {
    list.push(warning)
  }
}

/** 快照内是否已有任何可用数据 */
function hasAnyData(snapshot: DeviceSnapshot): boolean {
  return (
    snapshot.devices.length > 0 ||
    snapshot.audio.masterVolume !== null ||
    snapshot.audio.outputs.length > 0 ||
    snapshot.pointer.speed !== null
  )
}

/**
 * 设备服务。
 *
 * refresh 并行读取三段数据并做并发去重；首次读到音频或指针数据时记录基线；
 * 全部写操作经内部串行队列执行，保证不并发调用后端。
 */
export class DeviceService {
  private readonly backend: DeviceBackend
  private readonly onSnapshot: (snapshot: DeviceSnapshot) => void
  private snapshot: DeviceSnapshot
  private baseline: DeviceBaseline | null = null
  private baselineCaptured = false
  private inFlight: Promise<DeviceSnapshot> | null = null
  private queue: Promise<void> = Promise.resolve()
  private disposed = false

  constructor(options: DeviceServiceOptions) {
    this.backend = options.backend
    this.onSnapshot = options.onSnapshot
    const snapshot = createEmptyDeviceSnapshot(
      options.backend.platform,
      'loading'
    )
    if (!options.backend.supported) {
      snapshot.supported = false
      snapshot.status = 'partial'
      snapshot.warnings = [DEVICE_WARNING_UNSUPPORTED]
    }
    this.snapshot = snapshot
  }

  /** 读取当前快照（不触发任何扫描） */
  getSnapshot(): DeviceSnapshot {
    return this.snapshot
  }

  /** 读取基线；尚未捕获时为 null */
  getBaseline(): DeviceBaseline | null {
    return this.baseline
  }

  /**
   * 刷新快照。
   *
   * 已有刷新在途时直接返回当前快照（Windows 全量扫描较慢，不排队重复扫描）；
   * 平台不支持或服务已停止时同样直接返回当前快照。
   */
  refresh(): Promise<DeviceSnapshot> {
    if (this.disposed || !this.backend.supported) {
      return Promise.resolve(this.snapshot)
    }
    if (this.inFlight) {
      return Promise.resolve(this.snapshot)
    }
    const task = this.performRefresh().finally(() => {
      this.inFlight = null
    })
    this.inFlight = task
    return task
  }

  setMasterVolume(volume: number): Promise<DeviceActionResult> {
    if (this.disposed) {
      return Promise.resolve(this.stoppedResult())
    }
    const value = clampVolume(volume)
    if (value === null) {
      return Promise.resolve({
        ok: false,
        error: ERROR_INVALID_VOLUME,
        snapshot: this.snapshot
      })
    }
    return this.enqueue(() =>
      this.runWrite(() => this.backend.setMasterVolume(value), 'audio')
    )
  }

  setOutputVolume(id: string, volume: number): Promise<DeviceActionResult> {
    if (this.disposed) {
      return Promise.resolve(this.stoppedResult())
    }
    if (typeof id !== 'string' || id.trim() === '') {
      return Promise.resolve({
        ok: false,
        error: ERROR_INVALID_OUTPUT,
        snapshot: this.snapshot
      })
    }
    const value = clampVolume(volume)
    if (value === null) {
      return Promise.resolve({
        ok: false,
        error: ERROR_INVALID_VOLUME,
        snapshot: this.snapshot
      })
    }
    return this.enqueue(() =>
      this.runWrite(() => this.backend.setOutputVolume(id, value), 'audio')
    )
  }

  setMuted(muted: boolean): Promise<DeviceActionResult> {
    if (this.disposed) {
      return Promise.resolve(this.stoppedResult())
    }
    if (typeof muted !== 'boolean') {
      return Promise.resolve({
        ok: false,
        error: ERROR_INVALID_MUTED,
        snapshot: this.snapshot
      })
    }
    return this.enqueue(() =>
      this.runWrite(() => this.backend.setMuted(muted), 'audio')
    )
  }

  setPointerSpeed(speed: number): Promise<DeviceActionResult> {
    if (this.disposed) {
      return Promise.resolve(this.stoppedResult())
    }
    const pointer = this.snapshot.pointer
    if (
      !isValidPointerSpeed(speed) ||
      speed < pointer.min ||
      speed > pointer.max
    ) {
      return Promise.resolve({
        ok: false,
        error: ERROR_INVALID_POINTER,
        snapshot: this.snapshot
      })
    }
    return this.enqueue(() =>
      this.runWrite(() => this.backend.setPointerSpeed(speed), 'pointer')
    )
  }

  /** 还原到基线；无基线时回退平台默认值 */
  resetToBaseline(): Promise<DeviceActionResult> {
    if (this.disposed) {
      return Promise.resolve(this.stoppedResult())
    }
    return this.enqueue(() => this.performReset())
  }

  /** 停止服务：后续写操作直接失败，且不再复用旧队列 */
  dispose(): void {
    this.disposed = true
    this.inFlight = null
    this.queue = Promise.resolve()
  }

  /** 单轮刷新：三段并行读取，逐段降级 */
  private async performRefresh(): Promise<DeviceSnapshot> {
    const [deviceResult, audioResult, pointerResult] = await Promise.allSettled(
      [
        this.backend.scanDevices(),
        this.backend.readAudio(),
        this.backend.readPointer()
      ]
    )

    const warnings: string[] = []
    let failureCount = 0
    let devices = this.snapshot.devices
    let hiddenDeviceCount = this.snapshot.hiddenDeviceCount
    let audio = this.snapshot.audio
    let pointer = this.snapshot.pointer

    if (deviceResult.status === 'fulfilled') {
      devices = deviceResult.value.devices
      hiddenDeviceCount = deviceResult.value.hiddenDeviceCount
      for (const warning of deviceResult.value.warnings) {
        pushWarning(warnings, warning)
      }
    } else {
      failureCount += 1
      pushWarning(warnings, WARNING_DEVICES_FAILED)
    }

    if (audioResult.status === 'fulfilled') {
      audio = audioResult.value
    } else {
      failureCount += 1
      pushWarning(warnings, WARNING_AUDIO_FAILED)
    }

    if (pointerResult.status === 'fulfilled') {
      pointer = pointerResult.value
    } else {
      failureCount += 1
      pushWarning(warnings, WARNING_POINTER_FAILED)
    }

    const next: DeviceSnapshot = {
      platform: this.backend.platform,
      supported: true,
      status: 'partial',
      devices,
      hiddenDeviceCount,
      audio,
      pointer,
      warnings,
      updatedAt: this.snapshot.updatedAt,
      updatedAtLabel: this.snapshot.updatedAtLabel
    }

    // 只有采集失败或后端回报的告警才降级；平台限制说明（macOS）属提示信息
    const degraded = failureCount > 0 || warnings.length > 0
    if (
      audioResult.status === 'fulfilled' &&
      this.backend.platform === 'darwin'
    ) {
      pushWarning(warnings, DEVICE_WARNING_MAC_VOLUME)
    }
    if (
      pointerResult.status === 'fulfilled' &&
      this.backend.platform === 'darwin'
    ) {
      pushWarning(warnings, DEVICE_WARNING_MAC_POINTER)
    }

    if (failureCount === 3 && !hasAnyData(next)) {
      next.status = 'failed'
    } else if (!degraded) {
      next.status = 'ready'
    }

    // 任意一段成功即视为一次有效刷新
    if (failureCount < 3) {
      next.updatedAt = Date.now()
      next.updatedAtLabel = formatDeviceUpdatedLabel(next.updatedAt)
    }

    this.captureBaseline(audio, pointer)
    this.snapshot = next
    this.onSnapshot(next)
    return next
  }

  /** 首次出现有效音频数据时记录基线，之后不再覆盖 */
  private captureBaseline(
    audio: AudioSnapshot,
    pointer: PointerSnapshot
  ): void {
    if (this.baselineCaptured) {
      return
    }
    if (audio.masterVolume === null && audio.outputs.length === 0) {
      return
    }
    const outputs: Record<string, number> = {}
    for (const output of audio.outputs) {
      if (output.volume !== null) {
        outputs[output.id] = output.volume
      }
    }
    this.baseline = {
      masterVolume: audio.masterVolume,
      masterMuted: audio.masterMuted,
      outputs,
      pointerSpeed: pointer.speed
    }
    this.baselineCaptured = true
  }

  /**
   * 执行写操作：成功后只重读对应片段（音频 / 指针），失败保留原快照且不抛出。
   *
   * 写操作后不做全量扫描：设备枚举在 Windows 上需要数秒，音量拖动会因此明显卡顿；
   * 设备列表由渲染层按可见性轮询更新。
   */
  private async runWrite(
    action: () => Promise<void>,
    reread: 'audio' | 'pointer'
  ): Promise<DeviceActionResult> {
    try {
      await action()
      if (reread === 'audio') {
        await this.reloadAudio()
      } else {
        await this.reloadPointer()
      }
      return { ok: true, snapshot: this.getSnapshot() }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : '操作失败',
        snapshot: this.getSnapshot()
      }
    }
  }

  /** 重读音频段并合并进快照；失败时保留旧值，交由后续轮询兜底 */
  private async reloadAudio(): Promise<void> {
    try {
      const audio = await this.backend.readAudio()
      this.snapshot = {
        ...this.snapshot,
        audio,
        updatedAt: Date.now(),
        updatedAtLabel: formatDeviceUpdatedLabel(Date.now())
      }
      this.captureBaseline(this.snapshot.audio, this.snapshot.pointer)
      this.onSnapshot(this.snapshot)
    } catch {
      // 写入已成功，读取失败不应让调用方判为失败
    }
  }

  /** 重读指针段并合并进快照；失败时保留旧值 */
  private async reloadPointer(): Promise<void> {
    try {
      const pointer = await this.backend.readPointer()
      this.snapshot = {
        ...this.snapshot,
        pointer,
        updatedAt: Date.now(),
        updatedAtLabel: formatDeviceUpdatedLabel(Date.now())
      }
      this.captureBaseline(this.snapshot.audio, this.snapshot.pointer)
      this.onSnapshot(this.snapshot)
    } catch {
      // 同上：失败不覆盖已有状态
    }
  }

  /** 还原基线或平台默认值，单项失败不影响后续项 */
  private async performReset(): Promise<DeviceActionResult> {
    if (this.disposed) {
      return this.stoppedResult()
    }
    const failures: string[] = []
    const run = async (
      label: string,
      action: () => Promise<void>
    ): Promise<void> => {
      try {
        await action()
      } catch {
        failures.push(label)
      }
    }

    const baseline = this.baseline
    if (baseline) {
      if (baseline.masterVolume !== null) {
        const volume = baseline.masterVolume
        await run(RESET_MASTER_FAILED, () =>
          this.backend.setMasterVolume(volume)
        )
      }
      await run(RESET_MUTED_FAILED, () =>
        this.backend.setMuted(baseline.masterMuted)
      )
      const currentIds = new Set(
        this.snapshot.audio.outputs.map((output) => output.id)
      )
      for (const [id, volume] of Object.entries(baseline.outputs)) {
        if (!currentIds.has(id)) {
          continue
        }
        await run(RESET_OUTPUT_FAILED, () =>
          this.backend.setOutputVolume(id, volume)
        )
      }
      if (baseline.pointerSpeed !== null) {
        const speed = baseline.pointerSpeed
        await run(RESET_POINTER_FAILED, () =>
          this.backend.setPointerSpeed(speed)
        )
      }
    } else {
      const pointer = this.snapshot.pointer
      await run(RESET_MASTER_FAILED, () =>
        this.backend.setMasterVolume(DEFAULT_MASTER_VOLUME)
      )
      await run(RESET_UNMUTE_FAILED, () => this.backend.setMuted(false))
      for (const output of this.snapshot.audio.outputs) {
        await run(RESET_OUTPUT_FAILED, () =>
          this.backend.setOutputVolume(output.id, DEFAULT_MASTER_VOLUME)
        )
      }
      const speed =
        pointerPercentToSpeed(50, pointer.min, pointer.max, pointer.step) ??
        pointer.min
      await run(RESET_POINTER_FAILED, () => this.backend.setPointerSpeed(speed))
    }

    await this.refresh()
    const snapshot = this.getSnapshot()
    return failures.length > 0
      ? { ok: false, error: failures.join('；'), snapshot }
      : { ok: true, snapshot }
  }

  /** 把任务追加到串行队列末尾 */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(() => task())
    this.queue = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  private stoppedResult(): DeviceActionResult {
    return { ok: false, error: ERROR_SERVICE_STOPPED, snapshot: this.snapshot }
  }
}
