// 管道鸟游戏引擎：纯逻辑实现，与 DOM / Canvas 完全解耦

/** 逻辑分辨率 */
export const WORLD_WIDTH = 320
export const WORLD_HEIGHT = 180
/** 地面线（小鸟碰撞盒触底即判定失败） */
export const GROUND_Y = 168
/** 小鸟固定横向位置（左边缘） */
export const BIRD_X = 64
/** 小鸟尺寸 */
export const BIRD_WIDTH = 20
export const BIRD_HEIGHT = 14
/** 小鸟初始顶部 y（约屏幕垂直居中） */
export const BIRD_START_Y = 72

/**
 * 物理参数（单位：px、px/s、px/s²）。
 * 约定：y 轴向下为正，因此向上的速度取负值。
 */
export const GRAVITY = 640
/** 拍翅初速度：负值表示向上 */
export const FLAP_VELOCITY = -210

/** 管道基础速度（px/s）与上限 */
export const BASE_SPEED = 70
export const MAX_SPEED = 130
/** 每得 1 分增加的速度（px/s） */
export const SPEED_PER_SCORE = 3

/** 缺口高度：初始值、下限、每分收窄量（px） */
export const BASE_GAP = 82
export const MIN_GAP = 58
export const GAP_PER_SCORE = 2

/** 管道宽度与生成 / 移除时的边界间距 */
export const PIPE_WIDTH = 26
export const PIPE_EDGE_MARGIN = 8
/** 上 / 下管段的最小可见高度 */
export const MIN_PIPE_HEIGHT = 18
/**
 * 缺口中心 y 的上下限。
 * 以最大缺口推导，保证任意分数下上、下管段都有可见高度。
 */
export const PIPE_CENTER_MIN = MIN_PIPE_HEIGHT + BASE_GAP / 2
export const PIPE_CENTER_MAX = GROUND_Y - MIN_PIPE_HEIGHT - BASE_GAP / 2

/** 开局到第一组管道的等待时间 */
export const INITIAL_SPAWN_TIMER_MS = 1200
/** 管道生成间隔：初始值、下限、每分缩短量 */
export const BASE_SPAWN_INTERVAL_MS = 1450
export const MIN_SPAWN_INTERVAL_MS = 1000
export const SPAWN_INTERVAL_PER_SCORE = 20

/** 碰撞盒四周内缩量（px），让判定更宽容 */
export const HITBOX_INSET = 2

export type GamePhase = 'idle' | 'running' | 'paused' | 'over'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** 一组上下管道共用同一缺口 */
export interface Pipe extends Rect {
  id: number
  /** 缺口中心 y */
  gapY: number
  /** 缺口高度 */
  gapHeight: number
  /** 是否已计过分，保证每组只加 1 分 */
  scored: boolean
}

export interface FlappyState {
  phase: GamePhase
  /** 已存活毫秒 */
  elapsedMs: number
  /** 当前得分（整数） */
  score: number
  /** 小鸟精灵顶部 y（px，向下为正） */
  birdY: number
  /** 垂直速度（px/s，向上为负） */
  birdVY: number
  /** 当前存在的管道组 */
  pipes: Pipe[]
  /** 距下次生成管道剩余毫秒 */
  spawnTimerMs: number
  /** 下一组管道 id */
  nextPipeId: number
  /** 是否已发生碰撞（phase 为 over 时为 true） */
  crashed: boolean
}

/** 生成整数随机值，闭区间 [min, max] */
function randomInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1))
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

/** 当前得分对应的管道速度，受上下限约束 */
export function speedForScore(score: number): number {
  const points = Math.floor(Math.max(0, score))
  return Math.min(BASE_SPEED + points * SPEED_PER_SCORE, MAX_SPEED)
}

/** 当前得分对应的缺口高度，随分数收窄但不低于下限 */
export function gapForScore(score: number): number {
  const points = Math.floor(Math.max(0, score))
  return Math.max(BASE_GAP - points * GAP_PER_SCORE, MIN_GAP)
}

/** 当前得分对应的管道生成间隔 */
export function spawnIntervalForScore(score: number): number {
  const points = Math.floor(Math.max(0, score))
  return Math.max(
    MIN_SPAWN_INTERVAL_MS,
    BASE_SPAWN_INTERVAL_MS - points * SPAWN_INTERVAL_PER_SCORE
  )
}

/** 生成一组位于右侧入场位置的管道 */
function createPipe(id: number, score: number): Pipe {
  return {
    id,
    x: WORLD_WIDTH + PIPE_EDGE_MARGIN,
    y: 0,
    width: PIPE_WIDTH,
    height: GROUND_Y,
    gapY: randomInt(PIPE_CENTER_MIN, PIPE_CENTER_MAX),
    gapHeight: gapForScore(score),
    scored: false
  }
}

/** 初始状态：待机、小鸟悬停在初始位置、无管道 */
export function createInitialState(): FlappyState {
  return {
    phase: 'idle',
    elapsedMs: 0,
    score: 0,
    birdY: BIRD_START_Y,
    birdVY: 0,
    pipes: [],
    spawnTimerMs: INITIAL_SPAWN_TIMER_MS,
    nextPipeId: 1,
    crashed: false
  }
}

/** 从 idle / over 开始新的一局，重置全部进度 */
export function start(state: FlappyState): FlappyState {
  if (state.phase !== 'idle' && state.phase !== 'over') return state
  return { ...createInitialState(), phase: 'running' }
}

/** 仅在 running 时暂停 */
export function pause(state: FlappyState): FlappyState {
  if (state.phase !== 'running') return state
  return { ...state, phase: 'paused' }
}

/** 仅在 paused 时恢复 */
export function resume(state: FlappyState): FlappyState {
  if (state.phase !== 'paused') return state
  return { ...state, phase: 'running' }
}

/** 重置为初始状态 */
export function reset(state: FlappyState): FlappyState {
  void state
  return createInitialState()
}

/** 拍翅：仅在 running 时生效，把垂直速度重置为向上初速 */
export function flap(state: FlappyState): FlappyState {
  if (state.phase !== 'running') return state
  return { ...state, birdVY: FLAP_VELOCITY }
}

/** 小鸟当前碰撞盒（四周内缩，比精灵图略小） */
export function birdHitbox(state: FlappyState): Rect {
  return {
    x: BIRD_X + HITBOX_INSET,
    y: state.birdY + HITBOX_INSET,
    width: BIRD_WIDTH - HITBOX_INSET * 2,
    height: BIRD_HEIGHT - HITBOX_INSET * 2
  }
}

/** 上管段矩形：从屏幕顶部延伸到缺口上沿 */
export function upperPipeRect(pipe: Pipe): Rect {
  const height = Math.max(0, pipe.gapY - pipe.gapHeight / 2)
  return { x: pipe.x, y: 0, width: pipe.width, height }
}

/** 下管段矩形：从缺口下沿延伸到地面 */
export function lowerPipeRect(pipe: Pipe): Rect {
  const top = pipe.gapY + pipe.gapHeight / 2
  return {
    x: pipe.x,
    y: top,
    width: pipe.width,
    height: Math.max(0, GROUND_Y - top)
  }
}

/** 推进一帧：返回新状态，不修改入参 */
export function step(state: FlappyState, deltaMs: number): FlappyState {
  if (state.phase !== 'running') return state
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) return state

  const deltaSeconds = deltaMs / 1000
  const speed = speedForScore(state.score)

  // 先叠加重力，再按新速度积分位移
  let birdVY = state.birdVY + GRAVITY * deltaSeconds
  let birdY = state.birdY + birdVY * deltaSeconds
  if (birdY < 0) {
    birdY = 0
    birdVY = 0
  }

  // 管道左移，完全越过左边界后移除
  let pipes = state.pipes
    .map((pipe) => ({ ...pipe, x: pipe.x - speed * deltaSeconds }))
    .filter((pipe) => pipe.x + pipe.width >= -PIPE_EDGE_MARGIN)

  // 右边缘越过小鸟左边缘时计分，每组只加一次
  let score = state.score
  pipes = pipes.map((pipe) => {
    if (pipe.scored || pipe.x + pipe.width > BIRD_X) return pipe
    score += 1
    return { ...pipe, scored: true }
  })

  // 计时归零时生成一组管道，并按分数重置间隔
  let spawnTimerMs = state.spawnTimerMs - deltaMs
  let nextPipeId = state.nextPipeId
  if (spawnTimerMs <= 0) {
    pipes.push(createPipe(nextPipeId, score))
    nextPipeId += 1
    spawnTimerMs = spawnIntervalForScore(score)
  }

  const nextState: FlappyState = {
    ...state,
    elapsedMs: state.elapsedMs + deltaMs,
    score,
    birdY,
    birdVY,
    pipes,
    spawnTimerMs,
    nextPipeId
  }

  const hitbox = birdHitbox(nextState)
  const hitPipe = nextState.pipes.some(
    (pipe) =>
      intersects(hitbox, upperPipeRect(pipe)) ||
      intersects(hitbox, lowerPipeRect(pipe))
  )
  const hitGround = hitbox.y + hitbox.height >= GROUND_Y
  if (hitPipe || hitGround) {
    return { ...nextState, phase: 'over', crashed: true }
  }
  return nextState
}
