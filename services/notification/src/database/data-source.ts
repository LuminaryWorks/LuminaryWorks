import "reflect-metadata";
import { DataSource } from "typeorm";
import { ALL_ENTITIES } from "./entities";
import { AuthMail1740000000000 } from "./migrations/1740000000000-AuthMail";

const url =
  process.env.NOTIFICATION_DATABASE_URL ??
  "postgres://notification:CHANGE_ME@127.0.0.1:5433/notification";

export default new DataSource({
  type: "postgres",
  url,
  entities: ALL_ENTITIES,
  migrations: [AuthMail1740000000000],
  synchronize: false,
});
