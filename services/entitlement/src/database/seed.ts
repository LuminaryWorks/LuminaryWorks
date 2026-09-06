import "reflect-metadata";
import dataSource from "./data-source";
import { applyCatalog } from "./seed-apply";

async function seed() {
  await dataSource.initialize();
  await applyCatalog(dataSource);
  // eslint-disable-next-line no-console
  console.log("Seed complete: products, plans, features, sample bundle");
  await dataSource.destroy();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
