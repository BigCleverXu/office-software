/** 8×8 恐龙剪影栅格：true 为实心像素，false 为透明空格 */
export const dinoThumbnail: readonly (readonly boolean[])[] = [
  [false, false, false, false, false, true, true, false],
  [false, false, false, true, true, true, true, false],
  [false, false, false, true, true, true, true, true],
  [true, false, false, true, true, true, false, false],
  [true, true, true, true, true, true, false, false],
  [false, false, true, true, true, false, false, false],
  [false, false, true, true, false, true, false, false],
  [false, false, true, true, false, true, true, false]
]
