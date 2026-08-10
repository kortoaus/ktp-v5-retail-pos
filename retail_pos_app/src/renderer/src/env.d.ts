/// <reference types="../../preload/index.d.ts" />

// Vite 번들 오디오 자산 (차임 보이스)
declare module "*.mp3" {
  const src: string;
  export default src;
}
