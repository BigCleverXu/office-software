<script setup lang="ts">
import type { FlappyState, GamePhase, Pipe, Rect } from '@/games/flappy/engine'
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
  BIRD_X,
  GROUND_Y,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  createInitialState,
  flap,
  lowerPipeRect,
  pause,
  reset,
  resume,
  speedForScore,
  start,
  step,
  upperPipeRect
} from '@/games/flappy/engine'

/** 单帧最大推进时间，避免切后台后瞬移 */
const MAX_DELTA_MS = 50
/** 小鸟扇翅两帧切换间隔 */
const FLAP_FRAME_MS = 110
/** 管口高度 */
const PIPE_CAP_HEIGHT = 7
/** 地面纹理循环宽度 */
const GROUND_PATTERN = 24

/** 画布取色结果，全部来自 CSS 变量 */
interface Palette {
  foreground: string
  muted: string
  accent: string
  background: string
}

/** CSS 变量缺失时的系统色兜底，避免硬编码十六进制颜色 */
const FALLBACK_PALETTE: Palette = {
  foreground: 'CanvasText',
  muted: 'GrayText',
  accent: 'Highlight',
  background: 'Canvas'
}

interface Cloud {
  x: number
  y: number
  alpha: number
  speed: number
}

/** 装饰云朵：缓慢左移 */
const clouds: Cloud[] = [
  { x: 46, y: 22, alpha: 0.4, speed: 4 },
  { x: 152, y: 12, alpha: 0.3, speed: 3 },
  { x: 252, y: 38, alpha: 0.36, speed: 5 }
]

const state = shallowRef<FlappyState>(createInitialState())
const best = useLocalStorage<number>('games:flappy:best', 0)
const palette = shallowRef<Palette>({ ...FALLBACK_PALETTE })
const canvasRef = ref<HTMLCanvasElement | null>(null)
const reduceMotion = usePreferredReducedMotion()
const prefersReducedMotion = computed(() => reduceMotion.value === 'reduce')

let ctx: CanvasRenderingContext2D | null = null
let dpr = 1
let rafId = 0
let lastTimestamp = 0
let animationMs = 0
let scrollX = 0

const scoreText = computed(() => String(state.value.score).padStart(3, '0'))
const bestText = computed(() => String(best.value).padStart(3, '0'))
const isPaused = computed(() => state.value.phase === 'paused')
const pauseDisabled = computed(() => {
  const phase = state.value.phase
  return phase === 'idle' || phase === 'over'
})
const pauseLabel = computed(() => (isPaused.value ? '继续' : '暂停'))
const pauseAriaLabel = computed(() =>
  isPaused.value ? '继续游戏' : '暂停游戏'
)

const phaseLabels: Record<GamePhase, string> = {
  idle: '待开始',
  running: '进行中',
  paused: '已暂停',
  over: '已结束'
}

const canvasLabel = computed(() => {
  const current = state.value
  const phase = phaseLabels[current.phase]
  return `管道鸟，当前得分 ${current.score}，最高分 ${best.value}，${phase}`
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
    accent: read('--color-primary', read('--primary', FALLBACK_PALETTE.accent)),
    background: read(
      '--color-background',
      read('--background', FALLBACK_PALETTE.background)
    )
  }
}

/** 按设备像素比放大后备缓冲区，逻辑坐标保持 320×180 */
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

/** 地面线 + 随滚动位移的纹理 */
function drawGround(context: CanvasRenderingContext2D, color: string): void {
  fillPixel(context, color, 0, GROUND_Y, WORLD_WIDTH, 1, 0.75)
  fillPixel(
    context,
    color,
    0,
    GROUND_Y + 1,
    WORLD_WIDTH,
    WORLD_HEIGHT - GROUND_Y - 1,
    0.18
  )
  const offset = prefersReducedMotion.value ? 0 : scrollX
  for (let index = 0; index < 15; index += 1) {
    const x = index * GROUND_PATTERN - (offset % GROUND_PATTERN)
    fillPixel(context, color, x, GROUND_Y + 5, 9, 2, 0.35)
  }
}

/** 单段管道：管身 + 管口 */
function drawPipeSegment(
  context: CanvasRenderingContext2D,
  colors: Palette,
  rect: Rect,
  capAtTop: boolean
): void {
  const x = Math.round(rect.x)
  const y = Math.round(rect.y)
  const width = Math.round(rect.width)
  const height = Math.round(rect.height)
  if (height <= 0) return

  fillPixel(context, colors.accent, x, y, width, height, 0.55)
  fillPixel(context, colors.foreground, x + 3, y, 2, height, 0.35)

  const capY = capAtTop ? y : y + height - PIPE_CAP_HEIGHT
  fillPixel(
    context,
    colors.accent,
    x - 2,
    capY,
    width + 4,
    PIPE_CAP_HEIGHT,
    0.9
  )
  fillPixel(context, colors.foreground, x - 2, capY, width + 4, 1, 0.5)
}

/** 一组上下管道 */
function drawPipe(
  context: CanvasRenderingContext2D,
  colors: Palette,
  pipe: Pipe
): void {
  drawPipeSegment(context, colors, upperPipeRect(pipe), false)
  drawPipeSegment(context, colors, lowerPipeRect(pipe), true)
}

/** 小鸟像素图：两帧扇翅，头部朝右 */
function drawBirdSprite(
  context: CanvasRenderingContext2D,
  colors: Palette,
  left: number,
  top: number,
  wingUp: boolean
): void {
  const rect = (x: number, y: number, width: number, height: number): void => {
    fillPixel(context, colors.foreground, left + x, top + y, width, height)
  }

  // 尾巴
  rect(0, 5, 4, 4)
  // 身体
  rect(3, 3, 11, 8)
  // 头部
  rect(12, 1, 6, 7)
  // 翅膀两帧
  if (wingUp) {
    rect(5, 0, 8, 4)
  } else {
    rect(5, 8, 8, 5)
  }
  // 喙与眼睛
  fillPixel(context, colors.accent, left + 17, top + 4, 3, 2)
  clearPixel(context, left + 14, top + 2, 2, 2)
}

/** 待机时小鸟轻微上下浮动 */
function idleBob(): number {
  if (prefersReducedMotion.value) return 0
  return Math.round(Math.sin(animationMs / 350) * 2)
}

/** 扇翅两帧：减少动效时固定一帧 */
function birdWingUp(elapsedMs: number): boolean {
  if (prefersReducedMotion.value) return false
  return Math.floor(elapsedMs / FLAP_FRAME_MS) % 2 === 0
}

function drawBird(
  context: CanvasRenderingContext2D,
  colors: Palette,
  current: FlappyState
): void {
  const bob = current.phase === 'idle' ? idleBob() : 0
  drawBirdSprite(
    context,
    colors,
    BIRD_X,
    Math.round(current.birdY) + bob,
    birdWingUp(current.elapsedMs)
  )
}

function draw(): void {
  const context = ctx
  if (!context) return
  const colors = palette.value
  const current = state.value
  context.clearRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT)
  context.globalAlpha = 1
  fillPixel(context, colors.background, 0, 0, WORLD_WIDTH, GROUND_Y)
  for (const cloud of clouds) {
    drawCloud(context, colors.muted, cloud.x, cloud.y, cloud.alpha)
  }
  drawGround(context, colors.muted)
  for (const pipe of current.pipes) {
    drawPipe(context, colors, pipe)
  }
  drawBird(context, colors, current)
}

/** 装饰漂移：减少动效或暂停时保持静态 */
function updateDecor(deltaMs: number): void {
  if (prefersReducedMotion.value) return
  if (state.value.phase === 'paused') return
  const deltaSeconds = deltaMs / 1000
  for (const cloud of clouds) {
    cloud.x -= cloud.speed * deltaSeconds
    if (cloud.x < -24) cloud.x = WORLD_WIDTH + 12
  }
  if (state.value.phase === 'running') {
    const speed = speedForScore(state.value.score)
    scrollX = (scrollX + speed * deltaSeconds) % GROUND_PATTERN
  }
}

function frame(timestamp: number): void {
  rafId = window.requestAnimationFrame(frame)
  const ratio = Math.max(1, window.devicePixelRatio || 1)
  if (ratio !== dpr) setupCanvas()

  const delta =
    lastTimestamp > 0 ? Math.min(timestamp - lastTimestamp, MAX_DELTA_MS) : 0
  lastTimestamp = timestamp
  animationMs += delta

  if (state.value.phase === 'running') {
    state.value = step(state.value, delta)
  }
  updateDecor(delta)
  draw()
}

/** 拍翅；从待机 / 结束开局，暂停时先继续 */
function handleFlap(): void {
  const current = state.value
  if (current.phase === 'idle' || current.phase === 'over') {
    state.value = flap(start(current))
    return
  }
  if (current.phase === 'paused') {
    state.value = resume(current)
    return
  }
  state.value = flap(current)
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
  state.value = start(reset(state.value))
}

function onPointerDown(event: PointerEvent): void {
  if (event.pointerType === 'mouse' && event.button !== 0) return
  handleFlap()
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

const FLAP_KEYS = new Set([' ', 'Spacebar', 'ArrowUp', 'w', 'W'])

function onKeyDown(event: KeyboardEvent): void {
  if (isEditableTarget(event.target)) return
  if (!FLAP_KEYS.has(event.key)) return
  event.preventDefault()
  handleFlap()
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
          aria-label="拍翅"
          @click="handleFlap"
        >
          <ArrowUp />
          <span>拍翅</span>
        </Button>
        <Button
          variant="outline"
          size="sm"
          :aria-label="pauseAriaLabel"
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
      <canvas ref="canvasRef" class="flappy-canvas" aria-hidden="true"></canvas>

      <div
        v-if="state.phase === 'idle'"
        class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/70 px-4 text-center"
      >
        <p class="text-sm font-medium">按空格或点击开始</p>
        <p class="text-xs text-muted-foreground">
          空格 / ↑ / W 拍翅，穿过管道缝隙
        </p>
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
      <span>空格 / ↑ / W 拍翅 · 点击画布也可拍翅</span>
      <span>纯单机 · 无需联网</span>
    </footer>
  </section>
</template>

<style scoped>
.flappy-canvas {
  display: block;
  width: 100%;
  height: auto;
  aspect-ratio: 16 / 9;
  image-rendering: pixelated;
}
</style>
