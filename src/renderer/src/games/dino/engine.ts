// 恐龙快跑游戏引擎：纯逻辑实现，与 DOM / Canvas 完全解耦

/** 逻辑分辨率 */
export const WORLD_WIDTH = 320
export const WORLD_HEIGHT = 120
/** 地面线（恐龙脚底所在的 y） */
export const GROUND_Y = 98
/** 恐龙固定横向位置（左边缘） */
export const DINO_X = 24
/** 恐龙站立尺寸 */
export const DINO_WIDTH = 18
export const DINO_HEIGHT = 22
/** 恐龙蹲下时的尺寸 */
export const DUCK_WIDTH = 22
export const DUCK_HEIGHT = 13
/** 物理与速度参数（单位：px、px/s、px/s²） */
export const GRAVITY = 1500
export const JUMP_VELOCITY = 430
export const BASE_SPEED = 105
export const MAX_SPEED = 265
/** 每前进这么多像素提升一档速度 */
export const SPEED_STEP_DISTANCE = 420
/** 每档速度增量 */
export const SPEED_STEP = 16
/** 分数换算：每 10 px 记 1 分 */
export const SCORE_PER_PIXEL = 0.1

export type GamePhase = 'idle' | 'running' | 'paused' | 'over'
export type ObstacleKind = 'cactus' | 'bird'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface Obstacle extends Rect {
  id: number
  kind: ObstacleKind
}

export interface GameState {
  phase: GamePhase
  /** 已存活毫秒 */
  elapsedMs: number
  /** 当前得分（整数） */
  score: number
  /** 累计前进距离（px） */
  distance: number
  /** 当前滚动速度（px/s） */
  speed: number
  /** 恐龙底部离地高度（px，站在地面为 0） */
  dinoOffsetY: number
  /** 垂直速度（px/s，向上为正） */
  dinoVY: number
  /** 是否蹲下 */
  ducking: boolean
  /** 是否在地面 */
  onGround: boolean
  /** 当前存在的障碍 */
  obstacles: Obstacle[]
  /** 距下次生成障碍剩余毫秒 */
  spawnTimerMs: number
  /** 下一个障碍 id */
  nextObstacleId: number
  /** 是否已发生碰撞（phase 为 over 时为 true） */
  crashed: boolean
}

/** 最高速度档位 */
const MAX_SPEED_LEVEL = (MAX_SPEED - BASE_SPEED) / SPEED_STEP
/** 碰撞盒四周内缩量（px），让判定更宽容 */
const HITBOX_INSET = 1
/** 障碍生成时超出右边界 / 移出左边界的间距 */
const EDGE_MARGIN = 8
/** 初始生成障碍的等待时间 */
const INITIAL_SPAWN_TIMER_MS = 900
/** 仙人掌尺寸范围 */
const CACTUS_MIN_WIDTH = 10
const CACTUS_MAX_WIDTH = 16
const CACTUS_MIN_HEIGHT = 14
const CACTUS_MAX_HEIGHT = 26
/** 翼龙尺寸与飞行高度范围（距地面 px） */
const BIRD_WIDTH = 22
const BIRD_HEIGHT = 14
const BIRD_MIN_ALTITUDE = 26
const BIRD_MAX_ALTITUDE = 46
/** 翼龙出现的概率 */
const BIRD_CHANCE = 0.3

/** 生成整数随机值，闭区间 [min, max] */
function randomInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1))
}

/** 当前速度档位对应的生成间隔（随档位收紧） */
function spawnIntervalMs(level: number): number {
  return Math.max(380, 1500 - level * 120) + Math.random() * 260
}

/** 创建一个位于右侧入场位置的障碍 */
function createObstacle(id: number): Obstacle {
  if (Math.random() < BIRD_CHANCE) {
    return {
      id,
      kind: 'bird',
      x: WORLD_WIDTH + EDGE_MARGIN,
      y: GROUND_Y - randomInt(BIRD_MIN_ALTITUDE, BIRD_MAX_ALTITUDE),
      width: BIRD_WIDTH,
      height: BIRD_HEIGHT
    }
  }
  const width = randomInt(CACTUS_MIN_WIDTH, CACTUS_MAX_WIDTH)
  const height = randomInt(CACTUS_MIN_HEIGHT, CACTUS_MAX_HEIGHT)
  return {
    id,
    kind: 'cactus',
    x: WORLD_WIDTH + EDGE_MARGIN,
    y: GROUND_Y - height,
    width,
    height
  }
}

/** 两个矩形是否相交（AABB） */
function intersects(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  )
}

/** 初始状态：待机、站在地面、无障碍 */
export function createInitialState(): GameState {
  return {
    phase: 'idle',
    elapsedMs: 0,
    score: 0,
    distance: 0,
    speed: BASE_SPEED,
    dinoOffsetY: 0,
    dinoVY: 0,
    ducking: false,
    onGround: true,
    obstacles: [],
    spawnTimerMs: INITIAL_SPAWN_TIMER_MS,
    nextObstacleId: 1,
    crashed: false
  }
}

/** 从 idle / over 开始新的一局，重置全部进度 */
export function start(state: GameState): GameState {
  if (state.phase !== 'idle' && state.phase !== 'over') return state
  return { ...createInitialState(), phase: 'running' }
}

/** 仅在 running 时暂停 */
export function pause(state: GameState): GameState {
  if (state.phase !== 'running') return state
  return { ...state, phase: 'paused' }
}

/** 仅在 paused 时恢复 */
export function resume(state: GameState): GameState {
  if (state.phase !== 'paused') return state
  return { ...state, phase: 'running' }
}

/** 重置为初始状态 */
export function reset(state: GameState): GameState {
  void state
  return createInitialState()
}

/** 跳跃：仅 running 且在地面时生效，蹲下时先取消蹲下 */
export function jump(state: GameState): GameState {
  if (state.phase !== 'running' || !state.onGround) return state
  return {
    ...state,
    ducking: false,
    onGround: false,
    dinoVY: JUMP_VELOCITY
  }
}

/** 设置蹲下：空中输入被忽略，落地后由调用方再次同步 */
export function setDucking(state: GameState, ducking: boolean): GameState {
  if (!state.onGround || state.ducking === ducking) return state
  return { ...state, ducking }
}

/** 恐龙当前碰撞盒（略内缩，蹲下时更矮更宽） */
export function dinoHitbox(state: GameState): Rect {
  const width = state.ducking ? DUCK_WIDTH : DINO_WIDTH
  const height = state.ducking ? DUCK_HEIGHT : DINO_HEIGHT
  return {
    x: DINO_X + HITBOX_INSET,
    y: GROUND_Y - height - state.dinoOffsetY + HITBOX_INSET,
    width: width - HITBOX_INSET * 2,
    height: height - HITBOX_INSET * 2
  }
}

/** 当前速度档位（从 0 开始，最高为速度上限对应的档位） */
export function speedLevel(state: GameState): number {
  const level = Math.floor(state.distance / SPEED_STEP_DISTANCE)
  return Math.min(Math.max(level, 0), MAX_SPEED_LEVEL)
}

/** 推进一帧：返回新状态，不修改入参 */
export function step(state: GameState, deltaMs: number): GameState {
  if (state.phase !== 'running') return state
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) return state

  const deltaSeconds = deltaMs / 1000
  const level = speedLevel(state)
  const speed = Math.min(BASE_SPEED + level * SPEED_STEP, MAX_SPEED)
  const distance = state.distance + speed * deltaSeconds
  const score = Math.floor(distance * SCORE_PER_PIXEL)

  // 跳跃物理：先受重力减速，再按速度积分位移
  let dinoVY = state.dinoVY - GRAVITY * deltaSeconds
  let dinoOffsetY = state.dinoOffsetY + dinoVY * deltaSeconds
  let onGround = state.onGround
  if (dinoOffsetY <= 0) {
    dinoOffsetY = 0
    dinoVY = 0
    onGround = true
  } else {
    onGround = false
  }

  // 障碍左移，完全越过左边界后移除
  const obstacles = state.obstacles
    .map((obstacle) => ({
      ...obstacle,
      x: obstacle.x - speed * deltaSeconds
    }))
    .filter((obstacle) => obstacle.x + obstacle.width >= -EDGE_MARGIN)

  // 计时归零时生成一个障碍，并重置为随速度收紧的间隔
  let spawnTimerMs = state.spawnTimerMs - deltaMs
  let nextObstacleId = state.nextObstacleId
  if (spawnTimerMs <= 0) {
    obstacles.push(createObstacle(nextObstacleId))
    nextObstacleId += 1
    spawnTimerMs = spawnIntervalMs(level)
  }

  const nextState: GameState = {
    ...state,
    elapsedMs: state.elapsedMs + deltaMs,
    score,
    distance,
    speed,
    dinoOffsetY,
    dinoVY,
    onGround,
    obstacles,
    spawnTimerMs,
    nextObstacleId
  }

  const hitbox = dinoHitbox(nextState)
  const crashed = obstacles.some((obstacle) => intersects(hitbox, obstacle))
  if (crashed) {
    return { ...nextState, phase: 'over', crashed: true }
  }
  return nextState
}
