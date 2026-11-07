import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC_KEY = "ai-platform:public";
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
