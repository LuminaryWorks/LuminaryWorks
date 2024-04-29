import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
  VersionColumn,
} from "typeorm";

@Entity({ name: "organization_seats" })
@Unique(["organizationId", "productCode"])
export class OrganizationSeatEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "organization_id", type: "varchar", length: 128 })
  organizationId!: string;

  @Column({ name: "product_code", type: "varchar", length: 64 })
  productCode!: string;

  @Column({ name: "seat_limit", type: "int" })
  seatLimit!: number;

  @Column({ name: "seat_used", type: "int", default: 0 })
  seatUsed!: number;

  @VersionColumn()
  version!: number;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
