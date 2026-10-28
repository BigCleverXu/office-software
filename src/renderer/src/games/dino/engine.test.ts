import { describe, expect, it } from 'vitest'
import type { GameState, Obstacle } from './engine'
import {
  BASE_SPEED,
  DUCK_HEIGHT,
  DUCK_WIDTH,
  DINO_X,
  GROUND_Y,
  JUMP_VELOCITY,
  MAX_SPEED,
  SCORE_PER_PIXEL,
  SPEED_STEP,
  SPEED_STEP_DISTANCE,
  WORLD_WIDTH,
  createInitialState,
  dinoHitbox,
  jump,
  pause,
  reset,
  resume,
  setDucking,
  speedLevel,
  start,
  step
} from './engine'

/** 构造一个 running 且站在地面的状态 */
function runningState(): GameState {
  return { ...createInitialState(), phase: 'running' }
}

/** 构造一个贴地的仙人掌障碍 */
function cactus(id: number, x: number): Obstacle {
  return {
    id,
    kind: 'cactus',
    x,
    y: GROUND_Y - 20,
    width: 12,
    height: 20
  }
}

describe('恐龙快跑：初始化', () => {
  it('初始状态各字段正确且处于 idle', () => {
    const state = createInitialState()
    expect(state.phase).toBe('idle')
    expect(state.elapsedMs).toBe(0)
    expect(state.score).toBe(0)
    expect(state.distance).toBe(0)
    expect(state.speed).toBe(BASE_SPEED)
    expect(state.dinoOffsetY).toBe(0)
    expect(state.dinoVY).toBe(0)
    expect(state.ducking).toBe(false)
    expect(state.onGround).toBe(true)
    expect(state.obstacles).toEqual([])
    expect(state.spawnTimerMs).toBe(900)
    expect(state.nextObstacleId).toBe(1)
    expect(state.crashed).toBe(false)
  })
})

describe('恐龙快跑：阶段流转', () => {
  it('start 从 idle 进入 running 并重置分数、距离与障碍', () => {
    const dirty: GameState = {
      ...createInitialState(),
      score: 12,
      distance: 120,
      obstacles: [cactus(1, 200)]
    }
    const started = start(dirty)
    expect(started.phase).toBe('running')
    expect(started.score).toBe(0)
    expect(started.distance).toBe(0)
    expect(started.obstacles).toEqual([])
    expect(started.crashed).toBe(false)
    expect(started.elapsedMs).toBe(0)
  })

  it('start 可以从 over 重新开局', () => {
    const over: GameState = {
      ...createInitialState(),
      phase: 'over',
      score: 42,
      distance: 420,
      crashed: true,
      obstacles: [cactus(3, 210)]
    }
    const restarted = start(over)
    expect(restarted.phase).toBe('running')
    expect(restarted.score).toBe(0)
    expect(restarted.distance).toBe(0)
    expect(restarted.obstacles).toEqual([])
    expect(restarted.crashed).toBe(false)
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
    expect(start(start(createInitialState()))).toEqual(
      start(createInitialState())
    )
  })

  it('reset 恢复初始状态', () => {
    const dirty: GameState = {
      ...runningState(),
      phase: 'over',
      score: 30,
      distance: 300,
      crashed: true,
      obstacles: [cactus(1, 100)]
    }
    expect(reset(dirty)).toEqual(createInitialState())
  })
})

describe('恐龙快跑：跳跃与蹲下', () => {
  it('jump 仅在 running 且在地面时生效', () => {
    const idle = createInitialState()
    expect(jump(idle)).toEqual(idle)

    const paused: GameState = { ...runningState(), phase: 'paused' }
    expect(jump(paused)).toEqual(paused)

    const airborne: GameState = {
      ...runningState(),
      onGround: false,
      dinoOffsetY: 30
    }
    expect(jump(airborne)).toEqual(airborne)
  })

  it('蹲下时跳跃会取消蹲下且不修改入参', () => {
    const ducked = setDucking(runningState(), true)
    const jumped = jump(ducked)
    expect(jumped.dinoVY).toBe(JUMP_VELOCITY)
    expect(jumped.onGround).toBe(false)
    expect(jumped.ducking).toBe(false)
    expect(ducked.dinoVY).toBe(0)
    expect(ducked.ducking).toBe(true)
  })

  it('起跳后持续推进会落地并归零垂直速度', () => {
    let state = jump(runningState())
    expect(state.onGround).toBe(false)
    let frames = 0
    while (!state.onGround && frames < 300) {
      state = step(state, 16)
      frames += 1
    }
    expect(state.onGround).toBe(true)
    expect(state.dinoOffsetY).toBe(0)
    expect(state.dinoVY).toBe(0)
    expect(frames).toBeGreaterThan(1)
  })

  it('蹲下改变碰撞盒尺寸，空中蹲下被忽略', () => {
    const standing = dinoHitbox(runningState())
    const ducked = dinoHitbox(setDucking(runningState(), true))
    expect(ducked.width).toBeGreaterThan(standing.width)
    expect(ducked.height).toBeLessThan(standing.height)
    expect(ducked.y).toBeGreaterThan(standing.y)
    expect(standing.x).toBe(DINO_X + 1)
    expect(ducked.width).toBe(DUCK_WIDTH - 2)
    expect(ducked.height).toBe(DUCK_HEIGHT - 2)

    const airborne: GameState = {
      ...runningState(),
      onGround: false,
      dinoOffsetY: 25
    }
    expect(setDucking(airborne, true)).toEqual(airborne)
  })
})

describe('恐龙快跑：推进与计分', () => {
  it('非 running 时 step 不推进', () => {
    const paused: GameState = {
      ...runningState(),
      phase: 'paused',
      score: 5,
      distance: 50
    }
    const next = step(paused, 1000)
    expect(next).toEqual(paused)
    expect(next.score).toBe(5)
    expect(next.distance).toBe(50)
  })

  it('分数随距离增长，速度按档位提升', () => {
    const oneSecond = step(runningState(), 1000)
    expect(oneSecond.distance).toBeCloseTo(BASE_SPEED, 5)
    expect(oneSecond.score).toBe(Math.floor(BASE_SPEED * SCORE_PER_PIXEL))
    expect(oneSecond.speed).toBe(BASE_SPEED)

    const stepped = step(
      { ...runningState(), distance: SPEED_STEP_DISTANCE },
      16
    )
    expect(stepped.speed).toBe(BASE_SPEED + SPEED_STEP)
    expect(stepped.score).toBe(Math.floor(stepped.distance * SCORE_PER_PIXEL))
    expect(stepped.score).toBeGreaterThan(oneSecond.score)
  })

  it('速度不超过 MAX_SPEED', () => {
    const far: GameState = {
      ...runningState(),
      distance: SPEED_STEP_DISTANCE * 100
    }
    expect(speedLevel(far)).toBe(10)
    const next = step(far, 16)
    expect(next.speed).toBe(MAX_SPEED)
    expect(next.speed).toBeLessThanOrEqual(MAX_SPEED)
  })

  it('speedLevel 在档位边界处正确', () => {
    const levelAt = (distance: number): number =>
      speedLevel({ ...runningState(), distance })
    expect(levelAt(0)).toBe(0)
    expect(levelAt(SPEED_STEP_DISTANCE - 0.01)).toBe(0)
    expect(levelAt(SPEED_STEP_DISTANCE)).toBe(1)
    expect(levelAt(SPEED_STEP_DISTANCE * 9)).toBe(9)
    expect(levelAt(SPEED_STEP_DISTANCE * 10)).toBe(10)
    expect(levelAt(SPEED_STEP_DISTANCE * 100)).toBe(10)
  })
})

describe('恐龙快跑：障碍', () => {
  it('障碍从右向左移动且不修改入参', () => {
    const state: GameState = {
      ...runningState(),
      obstacles: [cactus(1, 300)]
    }
    const next = step(state, 16)
    expect(next.obstacles).toHaveLength(1)
    expect(next.obstacles[0].x).toBeLessThan(300)
    expect(state.obstacles[0].x).toBe(300)
  })

  it('越过左边界的障碍会被移除', () => {
    const state: GameState = {
      ...runningState(),
      obstacles: [cactus(1, 200), cactus(2, -30)]
    }
    const next = step(state, 16)
    expect(next.obstacles).toHaveLength(1)
    expect(next.obstacles[0].id).toBe(1)
  })

  it('计时归零时生成障碍、重置计时器并递增 id', () => {
    const state: GameState = {
      ...runningState(),
      spawnTimerMs: 5
    }
    const next = step(state, 16)
    expect(next.obstacles).toHaveLength(1)
    const [obstacle] = next.obstacles
    expect(obstacle.x).toBe(WORLD_WIDTH + 8)
    expect(obstacle.id).toBe(1)
    expect(next.nextObstacleId).toBe(2)
    expect(next.spawnTimerMs).toBeGreaterThanOrEqual(380)

    if (obstacle.kind === 'cactus') {
      expect(obstacle.width).toBeGreaterThanOrEqual(10)
      expect(obstacle.width).toBeLessThanOrEqual(16)
      expect(obstacle.height).toBeGreaterThanOrEqual(14)
      expect(obstacle.height).toBeLessThanOrEqual(26)
      expect(obstacle.y).toBe(GROUND_Y - obstacle.height)
    } else {
      expect(obstacle.width).toBe(22)
      expect(obstacle.height).toBe(14)
      expect(obstacle.y).toBeGreaterThanOrEqual(GROUND_Y - 46)
      expect(obstacle.y).toBeLessThanOrEqual(GROUND_Y - 26)
    }
  })

  it('与障碍相交后进入 over 且 crashed 为 true', () => {
    const state: GameState = {
      ...runningState(),
      obstacles: [cactus(1, 30)]
    }
    const next = step(state, 16)
    expect(next.phase).toBe('over')
    expect(next.crashed).toBe(true)

    const afterCrash = step(next, 100)
    expect(afterCrash).toEqual(next)
  })

  it('蹲下可以躲过站立会撞到的翼龙', () => {
    const bird: Obstacle = {
      id: 1,
      kind: 'bird',
      x: 30,
      y: GROUND_Y - 26,
      width: 22,
      height: 14
    }
    const standing: GameState = {
      ...runningState(),
      obstacles: [{ ...bird }]
    }
    expect(step(standing, 0.5).phase).toBe('over')

    const ducked: GameState = {
      ...runningState(),
      ducking: true,
      obstacles: [{ ...bird }]
    }
    expect(step(ducked, 0.5).phase).toBe('running')
  })
})
