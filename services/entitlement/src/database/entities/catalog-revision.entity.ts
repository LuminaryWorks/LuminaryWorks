import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import type { CatalogRevisionStatus } from "../../common/catalog-pricing";
import { OfferingEntity } from "./offering.entity";

@Entity({ name: "catalog_revisions" })
export class CatalogRevisionEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Index({ unique: true })
  @Column({ type: "int" })
  version!: number;

  @Index()
  @Column({ type: "varchar", length: 32, default: "draft" })
  status!: CatalogRevisionStatus;

  @Column({ type: "text", nullable: true })
  notes!: string | null;

  @Column({ name: "published_at", type: "timestamptz", nullable: true })
  publishedAt!: Date | null;

  @Column({ name: "superseded_at", type: "timestamptz", nullable: true })
  supersededAt!: Date | null;

  @OneToMany(
    () => OfferingEntity,
    (offering) => offering.revision,
  )
  offerings!: OfferingEntity[];

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
