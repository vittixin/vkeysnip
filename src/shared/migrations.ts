import {
  DEFAULT_EXCLUSIONS,
  DEFAULT_SETTINGS,
  SCHEMA_VERSION,
  type Library,
  type Settings,
} from "./schema";

export type StoredLibrary = Omit<Library, "schemaVersion">;

export type MigrationInput = {
  snippets?: StoredLibrary["snippets"];
  folders?: StoredLibrary["folders"];
  settings?: Partial<Settings>;
  exclusions?: StoredLibrary["exclusions"];
};

type Migration = (data: MigrationInput) => StoredLibrary;

const migrations: Record<number, Migration> = {
  1: (data) => ({
    snippets: data.snippets ?? {},
    folders: data.folders ?? {},
    settings: { ...DEFAULT_SETTINGS, ...data.settings },
    exclusions: data.exclusions ?? [...DEFAULT_EXCLUSIONS],
  }),
};

export function migrateLibrary(
  data: MigrationInput,
  fromVersion: number,
  toVersion = SCHEMA_VERSION,
): StoredLibrary {
  if (
    !Number.isInteger(fromVersion) ||
    fromVersion < 0 ||
    fromVersion > toVersion
  ) {
    throw new Error(`Unsupported schema version: ${fromVersion}`);
  }

  let migrated: MigrationInput = data;
  for (let version = fromVersion + 1; version <= toVersion; version += 1) {
    const migration = migrations[version];
    if (!migration)
      throw new Error(`Missing migration for schema version ${version}`);
    migrated = migration(migrated);
  }

  return {
    snippets: migrated.snippets ?? {},
    folders: migrated.folders ?? {},
    settings: { ...DEFAULT_SETTINGS, ...migrated.settings },
    exclusions: migrated.exclusions ?? [...DEFAULT_EXCLUSIONS],
  };
}
