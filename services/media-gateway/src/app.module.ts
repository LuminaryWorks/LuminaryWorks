import { Module } from "@nestjs/common";
import { loadConfig } from "./config";
import { GatewayController } from "./gateway.controller";
import { GatewayService } from "./gateway.service";

@Module({
  controllers: [GatewayController],
  providers: [
    {
      provide: GatewayService,
      useFactory: () => new GatewayService(loadConfig()),
    },
  ],
})
export class AppModule {}
