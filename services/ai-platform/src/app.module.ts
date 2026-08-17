import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AiGatewayController } from "./ai-gateway.controller";
import { AiGatewayService } from "./ai-gateway.service";

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  controllers: [AiGatewayController],
  providers: [AiGatewayService],
})
export class AppModule {}
