import fs from "node:fs";

const files = [
  "src/modules/entitlements/entitlements.service.ts",
  "src/modules/orders/orders.service.ts",
  "src/modules/admin/admin.service.ts",
  "src/modules/partner/partner-redemption.service.ts",
  "src/modules/trials/trials.service.ts",
  "src/modules/license/license.service.ts",
];

for (const rel of files) {
  let c = fs.readFileSync(rel, "utf8");
  if (!c.includes("InjectDataSource")) {
    if (c.includes('import { InjectRepository } from "@nestjs/typeorm";')) {
      c = c.replace(
        'import { InjectRepository } from "@nestjs/typeorm";',
        'import { InjectDataSource, InjectRepository } from "@nestjs/typeorm";',
      );
    } else if (!c.includes("@nestjs/typeorm")) {
      c = c.replace(
        'import { Injectable } from "@nestjs/common";',
        'import { Injectable } from "@nestjs/common";\nimport { InjectDataSource } from "@nestjs/typeorm";',
      );
    }
  }
  if (!c.includes("@InjectDataSource()")) {
    c = c.replace(
      /constructor\(\s*\n\s*private readonly dataSource: DataSource,/,
      "constructor(\n    @InjectDataSource()\n    private readonly dataSource: DataSource,",
    );
  }
  // Ensure DataSource is a value import (Nest emitDecoratorMetadata / InjectDataSource)
  c = c.replace(
    /import type \{ DataSource(?:, Repository)? \} from "typeorm";/,
    'import { DataSource, type Repository } from "typeorm";',
  );
  c = c.replace(
    /import \{ type DataSource, In, type Repository \} from "typeorm";/,
    'import { DataSource, In, type Repository } from "typeorm";',
  );
  c = c.replace(
    /import \{ In, type DataSource, type Repository \} from "typeorm";/,
    'import { DataSource, In, type Repository } from "typeorm";',
  );
  fs.writeFileSync(rel, c);
  console.log("ok", rel);
}
