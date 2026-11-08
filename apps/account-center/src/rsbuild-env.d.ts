/// <reference types="@rsbuild/core/types" />

declare module "*.css" {
  const css: string;
  export default css;
}

declare module "*.svg?url" {
  const src: string;
  export default src;
}
