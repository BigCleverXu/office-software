<script setup lang="ts">
import type { GamePhase, GameState, Obstacle } from '@/games/dino/engine'
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import {
  useEventListener,
  useLocalStorage,
  useMutationObserver,
  usePreferredReducedMotion
} from '@vueuse/core'
import { ArrowUp, Pause, Play, RotateCcw } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import {
  DINO_HEIGHT,
  DINO_X,
  DUCK_HEIGHT,
  GROUND_Y,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  createInitialState,
  jump,
  pause,
  reset,
  resume,
  setDucking,
  start,
  step
} from '@/games/dino/engine'

/** 单帧最大推进时间，避免切后台后瞬移 */
const MAX_DELTA_MS = 50
/** 奔跑两帧切换间隔 */
const RUN_FRAME_MS = 120
/** 翼龙扇翅两帧间隔 */
const BIRD_FRAME_MS = 160

/** 画布取色结果，全部来自 CSS 变量 */
interface Palette {
  foreground: string
  muted: string
  accent: string
}

/** CSS 变量缺失时的系统色兜底，避免硬编码十六进制颜色 */
const FALLBACK_PALETTE: Palette = {
  foreground: 'CanvasText',
  muted: 'GrayText',
  accent: 'Highlight'
}

interface Cloud {
  x: number
  y: number
  alpha: number
  speed: number
}

interface Pebble {
  x: number
  dy: number
  width: number
}

type DinoPose = 'stand' | 'run-a' | 'run-b' | 'jump'

/** 装饰云朵：缓慢左移 */
const clouds: Cloud[] = [
  { x: 46, y: 16, alpha: 0.4, speed: 4 },
  { x: 148, y: 9, alpha: 0.3, speed: 3 },
  { x: 246, y: 28, alpha: 0.36, speed: 5 }
]

/** 3×5 像素字模，用于画布内的最高分标记 */
const PIXEL_GLYPHS: Record<string, readonly string[]> = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '001', '010', '010'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
  H: ['101', '101', '111', '101', '101'],
  I: ['111', '010', '010', '010', '111'],
  ' ': ['000', '000', '000', '000', '000']
}

/** 随机碎石点，仅初始化一次 */
function createPebbles(): Pebble[] {
  const pebbles: Pebble[] = []
  for (let index = 0; index < 26; index += 1) {
    pebbles.push({
      x: Math.random() * WORLD_WIDTH,
      dy: Math.floor(Math.random() * 3),
      width: 2 + Math.floor(Math.random() * 2)
    })
  }
  return pebbles
}

const pebbles = createPebbles()

const state = shallowRef<GameState>(createInitialState())
const best = useLocalStorage<number>('games:dino:best', 0)
const palette = shallowRef<Palette>({ ...FALLBACK_PALETTE })
const duckHeld = ref(false)
const canvasRef = ref<HTMLCanvasElement | null>(null)
const reduceMotion = usePreferredReducedMotion()
const prefersReducedMotion = computed(() => reduceMotion.value === 'reduce')

let ctx: CanvasRenderingContext2D | null = null
let dpr = 1
let rafId = 0
let lastTimestamp = 0
let scrollX = 0

const scoreText = computed(() => String(state.value.score).padStart(5, '0'))
const bestText = computed(() => String(best.value).padStart(5, '0'))
const isPaused = computed(() => state.value.phase === 'paused')
const pauseDisabled = computed(() => {
  const phase = state.value.phase
  return phase === 'idle' || phase === 'over'
})
const pauseLabel = computed(() => (isPaused.value ? '继续' : '暂停'))

const phaseLabels: Record<GamePhase, string> = {
  idle: '待开始',
  running: '进行中',
  paused: '已暂停',
  over: '已结束'
}

const canvasLabel = computed(() => {
  const current = state.value
  const phase = phaseLabels[current.phase]
  return `恐龙快跑，当前得分 ${current.score}，最高分 ${best.value}，${phase}`
})

/** 读取主题色：浅色 / 深色切换后重新拉取 */
function readPalette(): void {
  const styles = getComputedStyle(document.documentElement)
  const read = (name: string, fallback: string): string =>
    styles.getPropertyValue(name).trim() || fallback
  palette.value = {
    foreground: read(
      '--color-foreground',
      read('--foreground', FALLBACK_PALETTE.foreground)
    ),
    muted: read(
      '--color-muted-foreground',
      read('--muted-foreground', FALLBACK_PALETTE.muted)
    ),
    accent: read('--color-primary', read('--primary', FALLBACK_PALETTE.accent))
  }
}

/** 按设备像素比放大后备缓冲区，逻辑坐标保持 320×120 */
function setupCanvas(): void {
  const canvas = canvasRef.value
  if (!canvas) return
  const ratio = Math.max(1, window.devicePixelRatio || 1)
  dpr = ratio
  canvas.width = Math.round(WORLD_WIDTH * ratio)
  canvas.height = Math.round(WORLD_HEIGHT * ratio)
  const context = canvas.getContext('2d')
  if (!context) return
  context.setTransform(1, 0, 0, 1, 0, 0)
  context.scale(ratio, ratio)
  context.imageSmoothingEnabled = false
  ctx = context
}

/** 像素块：坐标统一取整，保证边缘清晰 */
function fillPixel(
  context: CanvasRenderingContext2D,
  color: string,
  x: number,
  y: number,
  width: number,
  height: number,
  alpha = 1
): void {
  if (width <= 0 || height <= 0) return
  context.globalAlpha = alpha
  context.fillStyle = color
  context.fillRect(
    Math.round(x),
    Math.round(y),
    Math.round(width),
    Math.round(height)
  )
}

/** 挖出透明像素（如眼睛），跟随卡片背景 */
function clearPixel(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number
): void {
  context.clearRect(
    Math.round(x),
    Math.round(y),
    Math.round(width),
    Math.round(height)
  )
}

/** 云朵：三块浅色像素拼成 */
function drawCloud(
  context: CanvasRenderingContext2D,
  color: string,
  x: number,
  y: number,
  alpha: number
): void {
  fillPixel(context, color, x, y + 2, 14, 3, alpha)
  fillPixel(context, color, x + 3, y, 8, 3, alpha)
  fillPixel(context, color, x + 9, y + 1, 7, 2, alpha)
}

/** 地面线 + 碎石点 */
function drawGround(context: CanvasRenderingContext2D, color: string): void {
  fillPixel(context, color, 0, GROUND_Y, WORLD_WIDTH, 1, 0.75)
  fillPixel(context, color, 0, GROUND_Y + 1, WORLD_WIDTH, 1, 0.5)
  const offset = prefersReducedMotion.value ? 0 : scrollX
  for (const pebble of pebbles) {
    const wrapped =
      (((pebble.x - offset) % WORLD_WIDTH) + WORLD_WIDTH) % WORLD_WIDTH
    fillPixel(
      context,
      color,
      wrapped,
      GROUND_Y + 2 + pebble.dy,
      pebble.width,
      1,
      0.45
    )
  }
}

/** 仙人掌：主树干 + 两侧分叉 */
function drawCactus(
  context: CanvasRenderingContext2D,
  color: string,
  obstacle: Obstacle
): void {
  const x = Math.round(obstacle.x)
  const y = Math.round(obstacle.y)
  const width = Math.round(obstacle.width)
  const height = Math.round(obstacle.height)
  const trunkWidth = Math.max(4, Math.round(width * 0.4))
  const trunkX = x + Math.round((width - trunkWidth) / 2)
  fillPixel(context, color, trunkX, y, trunkWidth, height)

  const leftGap = trunkX - x
  if (leftGap >= 3) {
    const armHeight = Math.max(4, Math.round(height * 0.3))
    const armY = y + Math.round(height * 0.42)
    fillPixel(context, color, x, armY, 3, armHeight)
    fillPixel(context, color, x, armY + armHeight - 2, leftGap + 2, 2)
  }

  const rightArmX = x + width - 3
  const rightGap = rightArmX - (trunkX + trunkWidth - 1)
  if (rightGap > 0) {
    const armHeight = Math.max(4, Math.round(height * 0.26))
    const armY = y + Math.round(height * 0.28)
    fillPixel(context, color, rightArmX, armY, 3, armHeight)
    fillPixel(
      context,
      color,
      trunkX + trunkWidth - 2,
      armY + armHeight - 2,
      rightGap + 1,
      2
    )
  }
}

/** 翼龙：翅膀上下两帧 */
function drawBird(
  context: CanvasRenderingContext2D,
  color: string,
  left: number,
  top: number,
  wingUp: boolean
): void {
  const rect = (x: number, y: number, width: number, height: number): void => {
    fillPixel(context, color, left + x, top + y, width, height)
  }

  rect(16, 6, 5, 3)
  rect(7, 5, 9, 5)
  rect(3, 4, 7, 5)
  rect(0, 6, 3, 2)
  if (wingUp) {
    rect(8, 1, 6, 4)
    rect(11, 0, 4, 3)
  } else {
    rect(8, 9, 6, 4)
    rect(11, 10, 4, 3)
  }
  clearPixel(context, left + 5, top + 5, 2, 2)
}

/** 恐龙当前姿势 */
function resolveDinoPose(current: GameState): DinoPose {
  if (current.phase !== 'running') return 'stand'
  if (!current.onGround) return 'jump'
  return Math.floor(current.elapsedMs / RUN_FRAME_MS) % 2 === 0
    ? 'run-a'
    : 'run-b'
}

/** 站立 / 奔跑 / 跳跃的恐龙像素图（18×22） */
function drawStandingDino(
  context: CanvasRenderingContext2D,
  color: string,
  left: number,
  top: number,
  pose: DinoPose
): void {
  const rect = (x: number, y: number, width: number, height: number): void => {
    fillPixel(context, color, left + x, top + y, width, height)
  }

  // 尾巴
  rect(0, 9, 5, 3)
  rect(2, 7, 4, 2)
  // 身体
  rect(5, 6, 9, 10)
  // 头部与下颚
  rect(8, 0, 10, 7)
  rect(12, 6, 6, 2)
  // 手臂
  rect(12, 11, 3, 1)
  rect(14, 12, 2, 1)

  if (pose === 'run-a') {
    rect(6, 15, 3, 3)
    rect(4, 18, 4, 2)
    rect(10, 15, 3, 5)
    rect(11, 20, 4, 2)
  } else if (pose === 'run-b') {
    rect(6, 15, 3, 5)
    rect(5, 20, 4, 2)
    rect(10, 15, 3, 3)
    rect(10, 18, 4, 2)
  } else if (pose === 'jump') {
    rect(6, 15, 3, 3)
    rect(5, 18, 4, 2)
    rect(10, 15, 3, 3)
    rect(11, 18, 4, 2)
  } else {
    rect(6, 15, 3, 5)
    rect(5, 20, 4, 2)
    rect(10, 15, 3, 5)
    rect(10, 20, 4, 2)
  }

  // 眼睛
  clearPixel(context, left + 13, top + 2, 2, 2)
}

/** 蹲下的恐龙像素图（22×13） */
function drawDuckingDino(
  context: CanvasRenderingContext2D,
  color: string,
  left: number,
  top: number
): void {
  const rect = (x: number, y: number, width: number, height: number): void => {
    fillPixel(context, color, left + x, top + y, width, height)
  }

  // 尾巴、身体、头部与下颚
  rect(0, 6, 5, 3)
  rect(4, 5, 10, 6)
  rect(12, 1, 9, 6)
  rect(15, 6, 6, 2)
  // 手臂
  rect(11, 9, 3, 1)
  // 腿
  rect(7, 10, 3, 2)
  rect(6, 11, 4, 2)
  rect(12, 10, 3, 2)
  rect(12, 11, 4, 2)

  clearPixel(context, left + 18, top + 2, 2, 2)
}

function drawDino(
  context: CanvasRenderingContext2D,
  colors: Palette,
  current: GameState
): void {
  const lifted = Math.round(current.dinoOffsetY)
  if (current.ducking) {
    drawDuckingDino(
      context,
      colors.foreground,
      DINO_X,
      GROUND_Y - DUCK_HEIGHT - lifted
    )
    return
  }
  drawStandingDino(
    context,
    colors.foreground,
    DINO_X,
    GROUND_Y - DINO_HEIGHT - lifted,
    resolveDinoPose(current)
  )
}

function drawObstacle(
  context: CanvasRenderingContext2D,
  colors: Palette,
  obstacle: Obstacle,
  elapsedMs: number
): void {
  if (obstacle.kind === 'cactus') {
    drawCactus(context, colors.foreground, obstacle)
    return
  }
  const wingUp = Math.floor(elapsedMs / BIRD_FRAME_MS) % 2 === 0
  drawBird(
    context,
    colors.foreground,
    Math.round(obstacle.x),
    Math.round(obstacle.y),
    wingUp
  )
}

/** 画布内竖排像素文字（3×5 字模） */
function drawPixelText(
  context: CanvasRenderingContext2D,
  color: string,
  text: string,
  x: number,
  y: number
): void {
  let cursor = Math.round(x)
  for (const character of text) {
    const glyph = PIXEL_GLYPHS[character]
    if (glyph) {
      glyph.forEach((row, rowIndex) => {
        for (let column = 0; column < 3; column += 1) {
          if (row.slice(column, column + 1) === '1') {
            fillPixel(context, color, cursor + column, y + rowIndex, 1, 1)
          }
        }
      })
    }
    cursor += 4
  }
}

/** 右上角最高分标记，使用强调色 */
function drawBestScore(
  context: CanvasRenderingContext2D,
  color: string,
  value: number
): void {
  if (value <= 0) return
  const digits = String(Math.min(value, 99999)).padStart(5, '0')
  const text = `HI ${digits}`
  const width = text.length * 4 - 1
  drawPixelText(context, color, text, WORLD_WIDTH - 8 - width, 6)
}

function draw(): void {
  const context = ctx
  if (!context) return
  const colors = palette.value
  const current = state.value
  context.clearRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT)
  context.globalAlpha = 1
  for (const cloud of clouds) {
    drawCloud(context, colors.muted, cloud.x, cloud.y, cloud.alpha)
  }
  drawGround(context, colors.muted)
  for (const obstacle of current.obstacles) {
    drawObstacle(context, colors, obstacle, current.elapsedMs)
  }
  drawDino(context, colors, current)
  drawBestScore(context, colors.accent, best.value)
}

/** 装饰漂移：减少动效或暂停时保持静态 */
function updateDecor(deltaMs: number): void {
  if (prefersReducedMotion.value) return
  const current = state.value
  if (current.phase === 'paused') return
  const deltaSeconds = deltaMs / 1000
  for (const cloud of clouds) {
    cloud.x -= cloud.speed * deltaSeconds
    if (cloud.x < -24) cloud.x = WORLD_WIDTH + 12
  }
  if (current.phase === 'running') {
    scrollX = (scrollX + current.speed * deltaSeconds) % WORLD_WIDTH
  }
}

function frame(timestamp: number): void {
  rafId = window.requestAnimationFrame(frame)
  const ratio = Math.max(1, window.devicePixelRatio || 1)
  if (ratio !== dpr) setupCanvas()

  const delta =
    lastTimestamp > 0 ? Math.min(timestamp - lastTimestamp, MAX_DELTA_MS) : 0
  lastTimestamp = timestamp

  if (state.value.phase === 'running') {
    const next = step(state.value, delta)
    state.value = next.onGround ? setDucking(next, duckHeld.value) : next
  }
  updateDecor(delta)
  draw()
}

/** 跳跃；从待机 / 结束开局，暂停时先继续 */
function handleJump(): void {
  const current = state.value
  if (current.phase === 'idle' || current.phase === 'over') {
    state.value = jump(start(current))
    return
  }
  if (current.phase === 'paused') {
    state.value = resume(current)
    return
  }
  state.value = jump(current)
}

function togglePause(): void {
  const current = state.value
  if (current.phase === 'running') {
    state.value = pause(current)
    return
  }
  if (current.phase === 'paused') {
    state.value = resume(current)
  }
}

function restart(): void {
  duckHeld.value = false
  state.value = start(reset(state.value))
}

function onPointerDown(event: PointerEvent): void {
  if (event.pointerType === 'mouse' && event.button !== 0) return
  handleJump()
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable
  )
}

const JUMP_KEYS = new Set([' ', 'Spacebar', 'ArrowUp', 'w', 'W'])
const DUCK_KEYS = new Set(['ArrowDown', 's', 'S'])

function onKeyDown(event: KeyboardEvent): void {
  if (isEditableTarget(event.target)) return
  if (JUMP_KEYS.has(event.key)) {
    event.preventDefault()
    handleJump()
    return
  }
  if (DUCK_KEYS.has(event.key)) {
    event.preventDefault()
    duckHeld.value = true
    if (state.value.phase === 'running') {
      state.value = setDucking(state.value, true)
    }
  }
}

function onKeyUp(event: KeyboardEvent): void {
  if (isEditableTarget(event.target)) return
  if (DUCK_KEYS.has(event.key)) {
    event.preventDefault()
    duckHeld.value = false
    state.value = setDucking(state.value, false)
  }
}

function onWindowBlur(): void {
  if (state.value.phase === 'running') {
    state.value = pause(state.value)
  }
}

watch(state, (current) => {
  if (current.phase !== 'over') return
  if (current.score > best.value) {
    best.value = current.score
  }
})

useEventListener(window, 'keydown', onKeyDown)
useEventListener(window, 'keyup', onKeyUp)
useEventListener(window, 'blur', onWindowBlur)

useMutationObserver(document.documentElement, () => readPalette(), {
  attributes: true,
  attributeFilter: ['class']
})

onMounted(() => {
  readPalette()
  setupCanvas()
  rafId = window.requestAnimationFrame(frame)
})

onUnmounted(() => {
  if (rafId) window.cancelAnimationFrame(rafId)
  rafId = 0
  ctx = null
})
</script>

<template>
  <section class="flex flex-col gap-3">
    <header class="flex flex-wrap items-end justify-between gap-2">
      <div class="flex items-center gap-5">
        <div class="flex flex-col gap-0.5">
          <span class="text-[0.7rem] text-muted-foreground">得分</span>
          <span class="font-mono text-lg font-semibold leading-none">
            {{ scoreText }}
          </span>
        </div>
        <div class="flex flex-col gap-0.5">
          <span class="text-[0.7rem] text-muted-foreground">最高分</span>
          <span
            class="font-mono text-lg font-semibold leading-none text-primary"
          >
            {{ bestText }}
          </span>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          aria-label="跳跃"
          @click="handleJump"
        >
          <ArrowUp />
          <span>跳跃</span>
        </Button>
        <Button
          variant="outline"
          size="sm"
          :aria-label="isPaused ? '继续游戏' : '暂停游戏'"
          :disabled="pauseDisabled"
          @click="togglePause"
        >
          <Play v-if="isPaused" />
          <Pause v-else />
          <span>{{ pauseLabel }}</span>
        </Button>
        <Button
          variant="outline"
          size="sm"
          aria-label="重新开始游戏"
          @click="restart"
        >
          <RotateCcw />
          <span>重新开始</span>
        </Button>
      </div>
    </header>

    <div
      class="relative touch-none select-none overflow-hidden rounded-2xl border border-border/70 bg-card shadow-soft outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
      role="img"
      :aria-label="canvasLabel"
      tabindex="0"
      @pointerdown="onPointerDown"
    >
      <canvas ref="canvasRef" class="dino-canvas" aria-hidden="true"></canvas>

      <div
        v-if="state.phase === 'idle'"
        class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/70 px-4 text-center"
      >
        <p class="text-sm font-medium">按空格或点击开始</p>
        <p class="text-xs text-muted-foreground">空格 / ↑ 跳跃，↓ 蹲下</p>
      </div>

      <div
        v-if="state.phase === 'paused'"
        class="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/80"
        @pointerdown.stop
      >
        <p class="text-sm font-medium">已暂停</p>
        <Button size="sm" aria-label="继续游戏" @click="togglePause">
          <Play />
          <span>继续</span>
        </Button>
      </div>

      <div
        v-if="state.phase === 'over'"
        class="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/80 px-4 text-center"
        @pointerdown.stop
      >
        <p class="text-sm font-medium">本次得分 {{ state.score }}</p>
        <p class="text-xs text-muted-foreground">最高分 {{ best }}</p>
        <Button size="sm" aria-label="重新开始游戏" @click="restart">
          <RotateCcw />
          <span>重新开始</span>
        </Button>
      </div>
    </div>

    <footer
      class="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"
    >
      <span>空格 / ↑ 跳跃 · ↓ 蹲下 · 点击画布也可跳跃</span>
      <span>纯单机 · 无需联网</span>
    </footer>
  </section>
</template>

<style scoped>
.dino-canvas {
  display: block;
  width: 100%;
  height: auto;
  aspect-ratio: 8 / 3;
  image-rendering: pixelated;
}
</style>
