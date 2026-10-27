<script setup lang="ts">
import { computed } from 'vue'
import { weatherScene } from '@/lib/weather-scene'

/** 组件属性：WMO 天气码、是否白天、降水量（mm） */
interface Props {
  code?: number
  isDay?: boolean
  precipitation?: number
}

const props = withDefaults(defineProps<Props>(), {
  code: -1,
  isDay: true,
  precipitation: 0
})

/** 当前场景配置：类型、强度与粒子数量 */
const scene = computed(() =>
  weatherScene(props.code, props.isDay, props.precipitation)
)
</script>

<template>
  <div
    class="weather-scene pointer-events-none absolute inset-0 overflow-hidden"
    :class="[`scene-${scene.kind}`, `level-${scene.level}`]"
    aria-hidden="true"
  >
    <!-- 太阳：呼吸核心 + 旋转光晕 -->
    <div v-if="scene.kind === 'sun' || scene.kind === 'partly'" class="sun">
      <span class="sun-glow"></span>
      <span class="sun-core"></span>
    </div>

    <!-- 月亮：柔光圆盘 + 两处环形山阴影 -->
    <div
      v-if="scene.kind === 'moon' || scene.kind === 'partly-night'"
      class="moon"
    ></div>

    <!-- 星星：夜间闪烁 -->
    <div v-if="scene.stars > 0" class="stars">
      <span v-for="index in scene.stars" :key="index" class="star"></span>
    </div>

    <!-- 云：椭圆模糊云团漂移 -->
    <div v-if="scene.clouds > 0" class="clouds">
      <span v-for="index in scene.clouds" :key="index" class="cloud"></span>
    </div>

    <!-- 雾：三条横向雾带往复漂移 -->
    <div v-if="scene.kind === 'fog'" class="fog">
      <span v-for="index in 3" :key="index" class="fog-band"></span>
    </div>

    <!-- 雨：雨滴下落并淡出 -->
    <div v-if="scene.drops > 0" class="rain">
      <span v-for="index in scene.drops" :key="index" class="drop"></span>
    </div>

    <!-- 雪：雪花下落 + 左右摇摆 -->
    <div v-if="scene.flakes > 0" class="snow">
      <span v-for="index in scene.flakes" :key="index" class="flake"></span>
    </div>

    <!-- 雷雨：低频闪电闪光 -->
    <div v-if="scene.kind === 'thunder'" class="bolts">
      <span class="bolt"></span>
      <span class="bolt"></span>
    </div>
  </div>
</template>

<style scoped>
/* 太阳：右上角，核心呼吸、光晕旋转 */
.sun {
  position: absolute;
  top: 8%;
  right: 10%;
  width: 92px;
  height: 92px;
}

.sun-glow,
.sun-core {
  position: absolute;
  border-radius: 50%;
}

.sun-glow {
  inset: -6%;
  background: repeating-conic-gradient(
    from 0deg,
    color-mix(in oklab, var(--color-weather-sun) 45%, transparent) 0deg 7deg,
    transparent 7deg 22deg
  );
  filter: blur(3px);
  opacity: 0.55;
  animation: sun-spin 28s linear infinite;
}

.sun-core {
  top: 50%;
  left: 50%;
  width: 34px;
  height: 34px;
  background: radial-gradient(
    circle,
    color-mix(in oklab, var(--color-weather-star) 92%, white) 0%,
    color-mix(in oklab, var(--color-weather-sun) 78%, transparent) 58%,
    transparent 100%
  );
  box-shadow: 0 0 22px
    color-mix(in oklab, var(--color-weather-sun) 35%, transparent);
  transform: translate(-50%, -50%);
  animation: sun-breathe 5s ease-in-out infinite;
}

/* 少云时太阳稍收敛，避免喧宾夺主 */
.scene-partly .sun {
  opacity: 0.82;
}

/* 月亮：右上角，缓慢明暗呼吸 */
.moon {
  position: absolute;
  top: 8%;
  right: 10%;
  width: 76px;
  height: 76px;
  border-radius: 50%;
  background: radial-gradient(
    circle at 38% 34%,
    color-mix(in oklab, var(--color-weather-moon) 32%, transparent),
    color-mix(in oklab, var(--color-weather-moon) 12%, transparent) 62%,
    transparent 80%
  );
  box-shadow: 0 0 26px
    color-mix(in oklab, var(--color-weather-moon) 12%, transparent);
  animation: moon-breathe 9s ease-in-out infinite;
}

.moon::before,
.moon::after {
  position: absolute;
  content: '';
  border-radius: 50%;
  border: 1.5px solid
    color-mix(in oklab, var(--color-weather-moon) 16%, transparent);
  background: color-mix(in oklab, var(--color-weather-moon) 6%, transparent);
}

.moon::before {
  top: 22%;
  left: 24%;
  width: 18px;
  height: 18px;
}

.moon::after {
  top: 52%;
  left: 54%;
  width: 11px;
  height: 11px;
}

/* 星星：固定散布，闪烁节奏各不相同 */
.stars {
  position: absolute;
  inset: 0;
}

.star {
  position: absolute;
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: color-mix(in oklab, var(--color-weather-star) 55%, transparent);
  animation: star-twinkle 4.2s ease-in-out infinite;
}

.star:nth-child(1) {
  top: 10%;
  left: 6%;
  animation-delay: -0.4s;
}

.star:nth-child(2) {
  top: 20%;
  left: 22%;
  animation-delay: -1.6s;
  animation-duration: 3.6s;
}

.star:nth-child(3) {
  top: 32%;
  left: 10%;
  animation-delay: -2.8s;
}

.star:nth-child(4) {
  top: 12%;
  left: 38%;
  animation-delay: -1.1s;
  animation-duration: 5.1s;
}

.star:nth-child(5) {
  top: 24%;
  left: 52%;
  animation-delay: -3.4s;
}

.star:nth-child(6) {
  top: 38%;
  left: 34%;
  animation-delay: -0.7s;
  animation-duration: 4.7s;
}

.star:nth-child(7) {
  top: 52%;
  left: 8%;
  animation-delay: -2.1s;
}

.star:nth-child(8) {
  top: 64%;
  left: 26%;
  animation-delay: -4.3s;
  animation-duration: 3.9s;
}

.star:nth-child(9) {
  top: 44%;
  left: 60%;
  animation-delay: -1.3s;
}

.star:nth-child(10) {
  top: 56%;
  left: 74%;
  animation-delay: -3.9s;
}

.star:nth-child(11) {
  top: 70%;
  left: 48%;
  animation-delay: -0.9s;
  animation-duration: 5.4s;
}

.star:nth-child(12) {
  top: 34%;
  left: 88%;
  width: 2px;
  height: 2px;
  animation-delay: -2.5s;
}

.star:nth-child(13) {
  top: 76%;
  left: 88%;
  width: 2px;
  height: 2px;
  animation-delay: -4.7s;
  animation-duration: 4.4s;
}

.star:nth-child(14) {
  top: 6%;
  left: 72%;
  width: 2px;
  height: 2px;
  animation-delay: -1.9s;
}

/* 云：椭圆 + 模糊，左右往返漂移 */
.clouds {
  position: absolute;
  inset: 0;
}

.cloud {
  position: absolute;
  height: 38px;
  border-radius: 999px;
  /* 白色主体 + 云色冷调，浅色卡片上仍有边界 */
  background: color-mix(in oklab, white 82%, var(--color-weather-cloud));
  box-shadow: 0 8px 18px
    color-mix(in oklab, var(--color-weather-cloud) 22%, transparent);
  filter: blur(6px);
  animation: cloud-drift 30s ease-in-out infinite alternate;
}

.cloud:nth-child(1) {
  top: 56%;
  left: 46%;
  width: 40%;
  height: 36px;
  opacity: 0.35;
  animation-delay: -6s;
}

.cloud:nth-child(2) {
  top: 22%;
  left: -8%;
  width: 52%;
  height: 46px;
  opacity: 0.42;
  animation-duration: 34s;
  animation-delay: -12s;
}

.cloud:nth-child(3) {
  top: 72%;
  left: 6%;
  width: 44%;
  opacity: 0.32;
  animation-duration: 40s;
  animation-delay: -20s;
}

.cloud:nth-child(4) {
  top: 38%;
  left: 54%;
  width: 38%;
  height: 32px;
  opacity: 0.28;
  animation-duration: 46s;
  animation-delay: -28s;
}

/* 阴天：云更密、漂移更慢 */
.scene-cloud .cloud {
  opacity: 0.5;
  filter: blur(8px);
  animation-duration: 46s;
}

/* 雾：横向雾带，慢速往复 */
.fog {
  position: absolute;
  inset: 0;
}

.fog-band {
  position: absolute;
  left: -12%;
  width: 124%;
  height: 22px;
  border-radius: 999px;
  background: color-mix(in oklab, var(--color-weather-fog) 26%, transparent);
  filter: blur(9px);
  animation: fog-drift 18s ease-in-out infinite alternate;
}

.fog-band:nth-child(1) {
  top: 40%;
}

.fog-band:nth-child(2) {
  top: 56%;
  opacity: 0.85;
  animation-duration: 24s;
  animation-delay: -7s;
}

.fog-band:nth-child(3) {
  top: 70%;
  opacity: 0.7;
  animation-duration: 30s;
  animation-delay: -15s;
}

/* 雨：细长渐变雨滴，自上而下落并淡出 */
.rain {
  position: absolute;
  inset: 0;
}

.drop {
  position: absolute;
  top: -12%;
  width: 2px;
  height: 22px;
  border-radius: 999px;
  background: linear-gradient(
    180deg,
    color-mix(in oklab, var(--color-weather-rain) 0%, transparent) 0%,
    color-mix(in oklab, var(--color-weather-rain) 45%, transparent) 62%,
    color-mix(in oklab, var(--color-weather-rain) 5%, transparent) 100%
  );
  animation: rain-fall 1.15s linear infinite;
}

.drop:nth-child(1) {
  left: 2%;
  animation-delay: -0.15s;
}

.drop:nth-child(2) {
  left: 6%;
  animation-delay: -0.55s;
}

.drop:nth-child(3) {
  left: 11%;
  animation-delay: -0.9s;
}

.drop:nth-child(4) {
  left: 15%;
  animation-delay: -0.3s;
}

.drop:nth-child(5) {
  left: 19%;
  animation-delay: -1.05s;
}

.drop:nth-child(6) {
  left: 24%;
  animation-delay: -0.7s;
}

.drop:nth-child(7) {
  left: 28%;
  animation-delay: -0.1s;
}

.drop:nth-child(8) {
  left: 32%;
  animation-delay: -0.85s;
}

.drop:nth-child(9) {
  left: 37%;
  animation-delay: -0.45s;
}

.drop:nth-child(10) {
  left: 41%;
  animation-delay: -1.1s;
}

.drop:nth-child(11) {
  left: 45%;
  animation-delay: -0.25s;
}

.drop:nth-child(12) {
  left: 50%;
  animation-delay: -0.95s;
}

.drop:nth-child(13) {
  left: 54%;
  animation-delay: -0.6s;
}

.drop:nth-child(14) {
  left: 58%;
  animation-delay: -0.05s;
}

.drop:nth-child(15) {
  left: 63%;
  animation-delay: -0.8s;
}

.drop:nth-child(16) {
  left: 67%;
  animation-delay: -0.35s;
}

.drop:nth-child(17) {
  left: 71%;
  animation-delay: -1s;
}

.drop:nth-child(18) {
  left: 76%;
  animation-delay: -0.2s;
}

.drop:nth-child(19) {
  left: 80%;
  animation-delay: -0.65s;
}

.drop:nth-child(20) {
  left: 84%;
  animation-delay: -0.9s;
}

.drop:nth-child(21) {
  left: 88%;
  animation-delay: -0.4s;
}

.drop:nth-child(22) {
  left: 92%;
  animation-delay: -1.1s;
}

.drop:nth-child(23) {
  left: 96%;
  animation-delay: -0.5s;
}

.drop:nth-child(24) {
  left: 4%;
  animation-delay: -0.75s;
}

.drop:nth-child(25) {
  left: 14%;
  animation-delay: -1s;
}

.drop:nth-child(26) {
  left: 26%;
  animation-delay: -0.3s;
}

.drop:nth-child(27) {
  left: 36%;
  animation-delay: -0.85s;
}

.drop:nth-child(28) {
  left: 48%;
  animation-delay: -0.55s;
}

.drop:nth-child(29) {
  left: 61%;
  animation-delay: -0.15s;
}

.drop:nth-child(30) {
  left: 86%;
  animation-delay: -0.95s;
}

/* 雨势分级：等级越高下落越快 */
.level-1 .drop {
  animation-duration: 1.15s;
}

.level-2 .drop {
  animation-duration: 0.9s;
}

.level-3 .drop {
  animation-duration: 0.65s;
}

/* 雪：圆形雪花，下落与摇摆两条动画叠加 */
.snow {
  position: absolute;
  inset: 0;
}

.flake {
  position: absolute;
  top: -8%;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: color-mix(in oklab, white 72%, var(--color-weather-snow));
  opacity: 0.5;
  animation:
    snow-fall 10s linear infinite,
    snow-sway 3.4s ease-in-out infinite alternate;
}

.flake:nth-child(1) {
  left: 3%;
  opacity: 0.5;
  animation-delay:
    -4.2s,
    -1.1s;
}

.flake:nth-child(2) {
  left: 9%;
  width: 5px;
  height: 5px;
  opacity: 0.45;
  animation-delay:
    -1.6s,
    -2.4s;
}

.flake:nth-child(3) {
  left: 15%;
  width: 7px;
  height: 7px;
  opacity: 0.6;
  animation-delay:
    -7.4s,
    -0.6s;
}

.flake:nth-child(4) {
  left: 21%;
  width: 4px;
  height: 4px;
  opacity: 0.4;
  animation-delay:
    -2.8s,
    -3.1s;
}

.flake:nth-child(5) {
  left: 27%;
  opacity: 0.55;
  animation-delay:
    -5.9s,
    -1.8s;
}

.flake:nth-child(6) {
  left: 33%;
  width: 5px;
  height: 5px;
  opacity: 0.42;
  animation-delay:
    -0.9s,
    -2.9s;
}

.flake:nth-child(7) {
  left: 39%;
  width: 8px;
  height: 8px;
  opacity: 0.6;
  animation-delay:
    -8.3s,
    -0.3s;
}

.flake:nth-child(8) {
  left: 45%;
  width: 4px;
  height: 4px;
  opacity: 0.38;
  animation-delay:
    -3.5s,
    -2s;
}

.flake:nth-child(9) {
  left: 51%;
  opacity: 0.52;
  animation-delay:
    -6.7s,
    -1.4s;
}

.flake:nth-child(10) {
  left: 57%;
  width: 5px;
  height: 5px;
  opacity: 0.45;
  animation-delay:
    -2.2s,
    -3.3s;
}

.flake:nth-child(11) {
  left: 63%;
  width: 7px;
  height: 7px;
  opacity: 0.58;
  animation-delay:
    -9.1s,
    -0.9s;
}

.flake:nth-child(12) {
  left: 69%;
  width: 4px;
  height: 4px;
  opacity: 0.4;
  animation-delay:
    -4.8s,
    -2.6s;
}

.flake:nth-child(13) {
  left: 75%;
  opacity: 0.5;
  animation-delay:
    -1.2s,
    -1.7s;
}

.flake:nth-child(14) {
  left: 81%;
  width: 5px;
  height: 5px;
  opacity: 0.44;
  animation-delay:
    -7.9s,
    -3.5s;
}

.flake:nth-child(15) {
  left: 87%;
  width: 8px;
  height: 8px;
  opacity: 0.62;
  animation-delay:
    -3.9s,
    -0.5s;
}

.flake:nth-child(16) {
  left: 93%;
  width: 4px;
  height: 4px;
  opacity: 0.38;
  animation-delay:
    -5.3s,
    -2.8s;
}

.flake:nth-child(17) {
  left: 6%;
  width: 4px;
  height: 4px;
  opacity: 0.35;
  animation-delay:
    -8.8s,
    -1.3s;
}

.flake:nth-child(18) {
  left: 18%;
  width: 5px;
  height: 5px;
  opacity: 0.48;
  animation-delay:
    -0.6s,
    -2.2s;
}

.flake:nth-child(19) {
  left: 36%;
  width: 7px;
  height: 7px;
  opacity: 0.56;
  animation-delay:
    -6.1s,
    -3.7s;
}

.flake:nth-child(20) {
  left: 54%;
  width: 4px;
  height: 4px;
  opacity: 0.36;
  animation-delay:
    -2.5s,
    -0.8s;
}

.flake:nth-child(21) {
  left: 72%;
  opacity: 0.5;
  animation-delay:
    -9.6s,
    -1.9s;
}

.flake:nth-child(22) {
  left: 90%;
  width: 5px;
  height: 5px;
  opacity: 0.42;
  animation-delay:
    -4.4s,
    -3s;
}

/* 落速分层，避免雪花步调一致 */
.flake:nth-child(3n) {
  animation-duration: 12s, 4.2s;
}

.flake:nth-child(3n + 1) {
  animation-duration: 8.5s, 3s;
}

/* 雷雨：用 clip-path 画闪电，低频闪烁 */
.bolts {
  position: absolute;
  inset: 0;
}

.bolt {
  position: absolute;
  width: 26px;
  height: 64px;
  background: linear-gradient(
    180deg,
    var(--color-weather-bolt),
    color-mix(in oklab, var(--color-weather-bolt) 35%, transparent)
  );
  clip-path: polygon(
    56% 0,
    100% 0,
    62% 38%,
    92% 38%,
    34% 100%,
    48% 52%,
    16% 52%
  );
  filter: drop-shadow(
    0 0 8px color-mix(in oklab, var(--color-weather-bolt) 55%, transparent)
  );
  opacity: 0;
  animation: bolt-flash 7.6s ease-out infinite;
}

.bolt:nth-child(1) {
  top: 16%;
  left: 62%;
}

.bolt:nth-child(2) {
  top: 38%;
  left: 26%;
  width: 20px;
  height: 52px;
  animation-duration: 8.8s;
  animation-delay: -3.2s;
}

/* 太阳核心呼吸，保持居中偏移 */
@keyframes sun-breathe {
  0%,
  100% {
    transform: translate(-50%, -50%) scale(0.92);
  }

  50% {
    transform: translate(-50%, -50%) scale(1.06);
  }
}

/* 光晕缓慢旋转 */
@keyframes sun-spin {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}

/* 月亮明暗呼吸 */
@keyframes moon-breathe {
  0%,
  100% {
    opacity: 0.78;
  }

  50% {
    opacity: 1;
  }
}

/* 星星闪烁 */
@keyframes star-twinkle {
  0%,
  100% {
    opacity: 0.12;
    transform: scale(0.7);
  }

  50% {
    opacity: 0.8;
    transform: scale(1);
  }
}

/* 云层左右往返漂移 */
@keyframes cloud-drift {
  from {
    transform: translate3d(-10%, 0, 0);
  }

  to {
    transform: translate3d(10%, 0, 0);
  }
}

/* 雾带左右往复 */
@keyframes fog-drift {
  from {
    transform: translate3d(-6%, 0, 0);
  }

  to {
    transform: translate3d(6%, 0, 0);
  }
}

/* 雨滴下落并淡出 */
@keyframes rain-fall {
  0% {
    top: -12%;
    opacity: 0;
  }

  15% {
    opacity: 0.85;
  }

  80% {
    opacity: 0.55;
  }

  100% {
    top: 112%;
    opacity: 0;
  }
}

/* 雪花垂直下落，与 sway 的 translate 组合生效 */
@keyframes snow-fall {
  from {
    top: -8%;
  }

  to {
    top: 110%;
  }
}

/* 雪花左右摇摆 */
@keyframes snow-sway {
  from {
    translate: -7px 0;
  }

  to {
    translate: 7px 0;
  }
}

/* 闪电闪光：周期内绝大部分时间不可见 */
@keyframes bolt-flash {
  0%,
  3%,
  6%,
  100% {
    opacity: 0;
  }

  0.6% {
    opacity: 0.7;
  }

  1.2% {
    opacity: 0.12;
  }

  1.8% {
    opacity: 0.55;
  }

  2.6% {
    opacity: 0.08;
  }

  3.4% {
    opacity: 0.35;
  }
}

/* 减少动效：隐藏粒子，太阳 / 云 / 雾保持静态构图 */
@media (prefers-reduced-motion: reduce) {
  .weather-scene * {
    animation: none !important;
  }

  .drop,
  .flake,
  .star,
  .bolt {
    display: none;
  }
}
</style>
