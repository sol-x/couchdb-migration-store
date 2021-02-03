import Nano from "nano";
import waitOn from "wait-on";

interface MigrationData {
  lastRun: string;
  migrations: Array<{ title: string; timestamp: string }>;
}

const MIGRATION_DB_NAME = "migrations";

type MigrationSaveCallback = (err?: Error) => void;
type MigrationLoadCallback = (
  err: Error | undefined,
  data?: MigrationData | {}
) => void;

class CouchDbMigrationStore {
  couchDbUrl: string;
  couchDbWaitTime: number;

  constructor() {
    const couchDbUrl = process.env.COUCHDB_URL;
    if (!couchDbUrl) {
      throw new Error(
        "Environment variable COUCHDB_URL must be set to use couchdb-migration-store"
      );
    }
    this.couchDbWaitTime =
      parseInt(process.env.COUCHDB_WAIT_TIME || "0") || 10 * 1000;
    this.couchDbUrl = couchDbUrl;
  }

  private async waitForCouchdb(): Promise<Nano.DocumentScope<MigrationData>> {
    await waitOn({
      resources: [this.couchDbUrl],
      timeout: this.couchDbWaitTime,
    });

    const nano = Nano(this.couchDbUrl);
    const allDbs = await nano.db.list();

    // Create MIGRATION_DB_NAME if it does not exist
    if (!allDbs.includes(MIGRATION_DB_NAME)) {
      await nano.db.create(MIGRATION_DB_NAME);
    }
    return nano.use<MigrationData>(MIGRATION_DB_NAME);
  }

  private async getMigrationDocument(
    db: Nano.DocumentScope<MigrationData>,
    docId: string
  ): Promise<Nano.DocumentGetResponse | undefined> {
    try {
      return await db.get(docId, { revs_info: true });
    } catch (e) {
      return;
    }
  }

  async save(
    migrationData: MigrationData,
    callback: MigrationSaveCallback
  ): Promise<void> {
    const { lastRun } = migrationData;
    const migrations = migrationData.migrations.map((migration) => ({
      title: migration.title,
      timestamp: migration.timestamp,
    }));
    const dataToStore = { _id: "1", lastRun, migrations };

    try {
      const db = await this.waitForCouchdb();

      const dataInStore = await this.getMigrationDocument(db, "1");

      if (dataInStore && dataInStore._rev) {
        await db.insert({ ...dataToStore, _rev: dataInStore._rev });
      } else {
        await db.insert(dataToStore);
      }
      callback(undefined);
    } catch (e) {
      console.error(`Encounter error when running migration ${lastRun}`);
      callback(e);
    }
  }

  async load(callback: MigrationLoadCallback): Promise<void> {
    try {
      const db = await this.waitForCouchdb();
      const data = await db.find({ limit: 1, selector: {} });
      const { docs } = data;
      if (docs.length) {
        callback(undefined, docs[0]);
      } else {
        callback(undefined, {});
      }
    } catch (e) {
      callback(e, {});
    }
  }
}

module.exports = CouchDbMigrationStore;
