import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import { BundleItemEntity } from "./bundle-item.entity";

@Entity({ name: "bundles" })
export class BundleEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Index({ unique: true })
  @Column({ type: "varchar", length: 64 })
  sku!: string;

  @Column({ type: "varchar", length: 128 })
  name!: string;

  @Column({ type: "boolean", default: true })
  active!: boolean;

  @OneToMany(
    () => BundleItemEntity,
    (i) => i.bundle,
  )
  items!: BundleItemEntity[];

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
