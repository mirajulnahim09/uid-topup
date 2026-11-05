/** Viewport matrix shared by responsive-matrix.ts and login-viewport.ts (CSS px, width × height). */
export const MATRIX: Array<[number, number]> = [
  // desktop
  [1920, 1080], [1680, 1050], [1600, 900], [1440, 900], [1366, 768], [1280, 800], [1280, 720],
  // small desktop / laptop
  [1152, 768], [1024, 768], [1024, 600], [960, 540],
  // tablet
  [820, 1180], [768, 1024], [600, 800],
  // mobile portrait
  [430, 932], [414, 896], [390, 844], [375, 812], [360, 800], [320, 640],
  // landscape phones / short windows
  [932, 430], [844, 390], [640, 320],
];
