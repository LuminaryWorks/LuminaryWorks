import { Module, type OnModuleInit } from "@nestjs/common";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";

@Module({
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule implements OnModuleInit {
  constructor(private readonly admin: AdminService) {}

  async onModuleInit(): Promise<void> {
    await this.admin.ensureSchema();
    this.admin.registerRefresher();
  }
}
