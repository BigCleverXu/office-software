import { describe, expect, it } from 'vitest'
import type {
  FlappyState,
  Pipe
} from '../../../../src/renderer/src/games/flappy/engine'
import {
  BASE_GAP,
  BASE_SPEED,
  BASE_SPAWN_INTERVAL_MS,
  BIRD_HEIGHT,
  BIRD_START_Y,
  BIRD_WIDTH,
  BIRD_X,
  FLAP_VELOCITY,
  GRAVITY,
  GROUND_Y,
  HITBOX_INSET,
  MAX_SPEED,
  MIN_GAP,
  MIN_PIPE_HEIGHT,
  PIPE_CENTER_MAX,
  PIPE_CENTER_MIN,
  PIPE_EDGE_MARGIN,
  PIPE_WIDTH,
  WORLD_WIDTH,
  birdHitbox,
  createInitialState,
  flap,
  gapForScore,
  lowerPipeRect,
  pause,
  reset,
  resume,
  speedForScore,
  start,
  step,
  upperPipeRect
} from '../../../../src/renderer/src/games/flappy/engine'

/** 构造一个 running 且小鸟悬停在初始位置的状态 */
function runningState(overrides: Partial<FlappyState> = {}): FlappyState {
  return { ...createInitialState(), phase: 'running', ...overrides }
}

/** 构造一组管道，默认远离小鸟、缺口居中 */
function makePipe(overrides: Partial<Pipe> = {}): Pipe {
  return {
    id: 1,
    x: 200,
    y: 0,
    width: PIPE_WIDTH,
    height: GROUND_Y,
    gapY: 90,
    gapHeight: BASE_GAP,
    scored: false,
    ...overrides
  }
}

describe('管道鸟：初始化', () => {
  it('初始状态各字段正确且处于 idle', () => {
    const state = createInitialState()
    expect(state.phase).toBe('idle')
    expect(state.elapsedMs).toBe(0)
    expect(state.score).toBe(0)
    expect(state.birdY).toBe(BIRD_START_Y)
    expect(state.birdVY).toBe(0)
    expect(state.pipes).toEqual([])
    expect(state.spawnTimerMs).toBe(1200)
    expect(state.nextPipeId).toBe(1)
    expect(state.crashed).toBe(false)
  })
})

describe('管道鸟：阶段流转', () => {
  it('start 从 idle 进入 running 并重置进度', () => {
    const dirty: FlappyState = {
      ...createInitialState(),
      score: 9,
      elapsedMs: 800,
      birdY: 20,
      birdVY: 40,
      pipes: [makePipe()],
      nextPipeId: 5,
      crashed: true
    }
    const started = start(dirty)
    expect(started.phase).toBe('running')
    expect(started.score).toBe(0)
    expect(started.elapsedMs).toBe(0)
    expect(started.birdY).toBe(BIRD_START_Y)
    expect(started.birdVY).toBe(0)
    expect(started.pipes).toEqual([])
    expect(started.nextPipeId).toBe(1)
    expect(started.crashed).toBe(false)
  })

  it('start 可以从 over 重新开局', () => {
    const over: FlappyState = {
      ...createInitialState(),
      phase: 'over',
      score: 3,
      pipes: [makePipe()],
      crashed: true
    }
    const restarted = start(over)
    expect(restarted.phase).toBe('running')
    expect(restarted.score).toBe(0)
    expect(restarted.crashed).toBe(false)
    expect(restarted.pipes).toEqual([])
  })

  it('pause / resume 只作用于对应阶段且幂等', () => {
    const running = runningState()
    const paused = pause(running)
    expect(paused.phase).toBe('paused')
    expect(resume(paused).phase).toBe('running')
    expect(pause(paused)).toEqual(paused)
    expect(resume(running)).toEqual(running)
    expect(pause(createInitialState())).toEqual(createInitialState())
    expect(start(paused)).toEqual(paused)
  })

  it('reset 恢复初始状态', () => {
    const dirty: FlappyState = {
      ...runningState(),
      phase: 'over',
      score: 6,
      crashed: true,
      pipes: [makePipe()]
    }
    expect(reset(dirty)).toEqual(createInitialState())
  })
})

describe('管道鸟：拍翅', () => {
  it('flap 仅在 running 时生效', () => {
    const idle = createInitialState()
    expect(flap(idle)).toEqual(idle)

    const paused: FlappyState = { ...runningState(), phase: 'paused' }
    expect(flap(paused)).toEqual(paused)

    const over: FlappyState = { ...runningState(), phase: 'over' }
    expect(flap(over)).toEqual(over)
  })

  it('flap 把垂直速度重置为向上初速且不修改入参', () => {
    const state = runningState({ birdY: 90, birdVY: 30 })
    const next = flap(state)
    expect(next.birdVY).toBe(FLAP_VELOCITY)
    expect(next.birdY).toBe(90)
    expect(state.birdVY).toBe(30)
  })
})

describe('管道鸟：物理推进', () => {
  it('step 按帧时长完成重力积分', () => {
    const state = runningState({ birdY: 72, birdVY: 0 })
    const next = step(state, 100)
    expect(next.birdVY).toBeCloseTo(GRAVITY * 0.1, 5)
    expect(next.birdY).toBeCloseTo(72 + GRAVITY * 0.1 * 0.1, 5)
    expect(next.elapsedMs).toBe(100)
  })

  it('跳帧后位置变化大于单帧', () => {
    const state = runningState()
    const short = step(state, 16)
    const long = step(state, 80)
    expect(long.elapsedMs).toBe(80)
    expect(long.birdY - state.birdY).toBeGreaterThan(short.birdY - state.birdY)
  })

  it('非正或非法 delta 不推进状态', () => {
    const state = runningState({ birdY: 60, birdVY: 0 })
    expect(step(state, 0)).toEqual(state)
    expect(step(state, -16)).toEqual(state)
    expect(step(state, Number.NaN)).toEqual(state)
    expect(step(state, Number.POSITIVE_INFINITY)).toEqual(state)
  })
})

describe('管道鸟：管道与计分', () => {
  it('管道左移且不修改入参', () => {
    const state = runningState({ pipes: [makePipe({ x: 200 })] })
    const next = step(state, 16)
    expect(next.pipes).toHaveLength(1)
    expect(next.pipes[0].x).toBeCloseTo(200 - BASE_SPEED * 0.016, 5)
    expect(state.pipes[0].x).toBe(200)
  })

  it('每组管道只计一次分，未越过小鸟时不计分', () => {
    const passed = runningState({
      pipes: [makePipe({ id: 1, x: 20 })]
    })
    const first = step(passed, 16)
    expect(first.score).toBe(1)
    expect(first.pipes[0].scored).toBe(true)

    const second = step(first, 16)
    expect(second.score).toBe(1)
    expect(second.pipes[0].scored).toBe(true)

    const ahead = runningState({
      pipes: [makePipe({ id: 2, x: BIRD_X + 10 })]
    })
    expect(step(ahead, 16).score).toBe(0)
  })

  it('计时归零时生成管道并重置计时器与 id', () => {
    const state = runningState({ spawnTimerMs: 5 })
    const next = step(state, 16)
    expect(next.pipes).toHaveLength(1)
    const [pipe] = next.pipes
    expect(pipe.id).toBe(1)
    expect(pipe.x).toBe(WORLD_WIDTH + PIPE_EDGE_MARGIN)
    expect(pipe.gapHeight).toBe(BASE_GAP)
    expect(pipe.gapY).toBeGreaterThanOrEqual(PIPE_CENTER_MIN)
    expect(pipe.gapY).toBeLessThanOrEqual(PIPE_CENTER_MAX)
    expect(upperPipeRect(pipe).height).toBeGreaterThanOrEqual(MIN_PIPE_HEIGHT)
    expect(lowerPipeRect(pipe).height).toBeGreaterThanOrEqual(MIN_PIPE_HEIGHT)
    expect(next.nextPipeId).toBe(2)
    expect(next.spawnTimerMs).toBe(BASE_SPAWN_INTERVAL_MS)
  })

  it('越过左边界的管道会被移除', () => {
    const state = runningState({
      pipes: [makePipe({ id: 1, x: 100 }), makePipe({ id: 2, x: -40 })]
    })
    const next = step(state, 16)
    expect(next.pipes).toHaveLength(1)
    expect(next.pipes[0].id).toBe(1)
  })
})

describe('管道鸟：碰撞', () => {
  it('小鸟碰撞盒相对精灵图四周内缩', () => {
    const box = birdHitbox(runningState({ birdY: 50 }))
    expect(box.x).toBe(BIRD_X + HITBOX_INSET)
    expect(box.y).toBe(50 + HITBOX_INSET)
    expect(box.width).toBe(BIRD_WIDTH - HITBOX_INSET * 2)
    expect(box.height).toBe(BIRD_HEIGHT - HITBOX_INSET * 2)
  })

  it('与管道相交后进入 over 且 crashed 为 true', () => {
    const state = runningState({
      pipes: [makePipe({ x: 60, gapY: 120, gapHeight: MIN_GAP })]
    })
    const next = step(state, 1)
    expect(next.phase).toBe('over')
    expect(next.crashed).toBe(true)

    const after = step(next, 100)
    expect(after).toEqual(next)
  })

  it('碰撞盒触地后进入 over', () => {
    const state = runningState({
      birdY: GROUND_Y - BIRD_HEIGHT + 2
    })
    const next = step(state, 1)
    expect(next.phase).toBe('over')
    expect(next.crashed).toBe(true)
  })
})

describe('管道鸟：难度', () => {
  it('得分越高速度越大且有上限', () => {
    expect(speedForScore(0)).toBe(BASE_SPEED)
    expect(speedForScore(10)).toBeGreaterThan(BASE_SPEED)
    expect(speedForScore(100)).toBe(MAX_SPEED)
    expect(speedForScore(1000)).toBe(MAX_SPEED)

    const slow = step(runningState({ pipes: [makePipe({ x: 200 })] }), 16)
    const fast = step(
      runningState({ score: 100, pipes: [makePipe({ x: 200 })] }),
      16
    )
    expect(fast.pipes[0].x).toBeLessThan(slow.pipes[0].x)
  })

  it('缺口随分数收窄且有下限', () => {
    expect(gapForScore(0)).toBe(BASE_GAP)
    expect(gapForScore(10)).toBeLessThan(BASE_GAP)
    expect(gapForScore(5)).toBeGreaterThan(gapForScore(6))
    expect(gapForScore(100)).toBe(MIN_GAP)
    expect(gapForScore(1000)).toBe(MIN_GAP)
    expect(gapForScore(1000)).toBeGreaterThanOrEqual(MIN_GAP)
  })
})

describe('管道鸟：非 running 不推进', () => {
  it('idle / paused / over 时 step 返回原状态', () => {
    const idle = createInitialState()
    expect(step(idle, 1000)).toEqual(idle)

    const paused: FlappyState = {
      ...runningState(),
      phase: 'paused',
      score: 3
    }
    expect(step(paused, 1000)).toEqual(paused)

    const over: FlappyState = {
      ...runningState(),
      phase: 'over',
      crashed: true
    }
    expect(step(over, 1000)).toEqual(over)
  })
})
