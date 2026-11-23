import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLongPressController } from '../../../src/renderer/src/lib/long-press'

const THRESHOLD = 500

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('createLongPressController', () => {
  it('未到阈值不触发', () => {
    const onTrigger = vi.fn()
    const controller = createLongPressController({
      thresholdMs: THRESHOLD,
      onTrigger
    })

    controller.start()
    vi.advanceTimersByTime(THRESHOLD - 1)

    expect(onTrigger).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('正好到阈值触发一次', () => {
    const onTrigger = vi.fn()
    const controller = createLongPressController({
      thresholdMs: THRESHOLD,
      onTrigger
    })

    controller.start()
    vi.advanceTimersByTime(THRESHOLD)

    expect(onTrigger).toHaveBeenCalledTimes(1)
  })

  it('提前 cancel 不触发', () => {
    const onTrigger = vi.fn()
    const onStateChange = vi.fn()
    const controller = createLongPressController({
      thresholdMs: THRESHOLD,
      onTrigger,
      onStateChange
    })

    controller.start()
    vi.advanceTimersByTime(THRESHOLD - 100)
    controller.cancel()
    vi.advanceTimersByTime(THRESHOLD)

    expect(onTrigger).not.toHaveBeenCalled()
    expect(onStateChange).toHaveBeenLastCalledWith(false)
  })

  it('重复 start 只触发一次', () => {
    const onTrigger = vi.fn()
    const controller = createLongPressController({
      thresholdMs: THRESHOLD,
      onTrigger
    })

    controller.start()
    controller.start()
    controller.start()
    vi.advanceTimersByTime(THRESHOLD)

    expect(onTrigger).toHaveBeenCalledTimes(1)
  })

  it('触发后可再次 start 并再次触发', () => {
    const onTrigger = vi.fn()
    const controller = createLongPressController({
      thresholdMs: THRESHOLD,
      onTrigger
    })

    controller.start()
    vi.advanceTimersByTime(THRESHOLD)
    controller.start()
    vi.advanceTimersByTime(THRESHOLD)

    expect(onTrigger).toHaveBeenCalledTimes(2)
  })

  it('dispose 取消未触发的计时', () => {
    const onTrigger = vi.fn()
    const controller = createLongPressController({
      thresholdMs: THRESHOLD,
      onTrigger
    })

    controller.start()
    vi.advanceTimersByTime(THRESHOLD - 200)
    controller.dispose()
    vi.advanceTimersByTime(THRESHOLD)

    expect(onTrigger).not.toHaveBeenCalled()
  })

  it('onStateChange 依次收到 true 与 false', () => {
    const states: boolean[] = []
    const controller = createLongPressController({
      thresholdMs: THRESHOLD,
      onTrigger: vi.fn(),
      onStateChange: (holding) => {
        states.push(holding)
      }
    })

    controller.start()
    controller.cancel()
    controller.start()
    vi.advanceTimersByTime(THRESHOLD)

    expect(states).toEqual([true, false, true, false])
  })
})
