import { afterEach, describe, expect, it } from 'vitest'
import {
  confirm,
  confirmState,
  settleConfirm
} from '../../../src/renderer/src/composables/useConfirm'

afterEach(() => {
  // 单例状态可能残留未结算请求，逐个用例后清理
  settleConfirm(false)
})

describe('useConfirm 默认值', () => {
  it('未传可选文案时使用默认标题、按钮文案与危险样式', async () => {
    const pending = confirm({ description: '删除后不可恢复' })

    expect(confirmState.value).toEqual({
      title: '确认操作',
      description: '删除后不可恢复',
      confirmText: '确定',
      cancelText: '取消',
      destructive: true
    })

    settleConfirm(true)
    await expect(pending).resolves.toBe(true)
  })
})

describe('useConfirm 自定义文案', () => {
  it('使用传入文案且 destructive 为 false', async () => {
    const pending = confirm({
      title: '清空分类',
      description: '确定清空该分类？',
      confirmText: '清空',
      cancelText: '再想想',
      destructive: false
    })

    expect(confirmState.value).toEqual({
      title: '清空分类',
      description: '确定清空该分类？',
      confirmText: '清空',
      cancelText: '再想想',
      destructive: false
    })

    settleConfirm(false)
    await expect(pending).resolves.toBe(false)
  })
})

describe('settleConfirm 结算', () => {
  it('确认后 Promise 返回 true 并清空 confirmState', async () => {
    const pending = confirm({ description: '继续操作' })

    settleConfirm(true)

    await expect(pending).resolves.toBe(true)
    expect(confirmState.value).toBeNull()
  })

  it('取消后 Promise 返回 false 并清空 confirmState', async () => {
    const pending = confirm({ description: '继续操作' })

    settleConfirm(false)

    await expect(pending).resolves.toBe(false)
    expect(confirmState.value).toBeNull()
  })
})

describe('useConfirm 串行请求', () => {
  it('新调用会把上一个未结算请求结算为 false', async () => {
    const first = confirm({ description: '旧请求' })
    const second = confirm({ description: '新请求' })

    await expect(first).resolves.toBe(false)
    expect(confirmState.value?.description).toBe('新请求')

    settleConfirm(true)
    await expect(second).resolves.toBe(true)
    expect(confirmState.value).toBeNull()
  })
})
