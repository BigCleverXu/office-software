/** 8×8 朝右小鸟剪影：上部头/喙，中部身体与翅膀，下部尾羽 */
export const flappyThumbnail: readonly (readonly boolean[])[] = [
  [false, false, false, false, true, true, true, false],
  [false, false, false, true, true, true, true, true],
  [false, false, false, false, true, true, true, false],
  [false, false, true, true, true, true, false, false],
  [false, true, true, true, true, true, false, false],
  [true, true, true, true, true, false, false, false],
  [true, true, true, true, false, false, false, false],
  [true, true, false, false, false, false, false, false]
]
