export const SCHEMA_VERSION = 1;

export type Snippet = {
  id: string;
  trigger: string;
  label: string;
  body: string;
  format: "text" | "html";
  folderId?: string;
  createdAt: number;
  updatedAt: number;
};

export type Folder = {
  id: string;
  name: string;
  order: number;
};

export type Settings = {
  triggerPrefix: string;
  mode: "delimiter" | "immediate";
  caseSensitive: boolean;
  theme: "system" | "light" | "dark";
};

export type Library = {
  schemaVersion: number;
  snippets: Record<string, Snippet>;
  folders: Record<string, Folder>;
  settings: Settings;
  exclusions: string[];
};

export const DEFAULT_SETTINGS: Settings = {
  triggerPrefix: ";",
  mode: "delimiter",
  caseSensitive: false,
  theme: "system",
};

export const DEFAULT_EXCLUSIONS = [
  "*.1password.com",
  "*.bitwarden.com",
  "*.lastpass.com",
  "*.keepersecurity.com",
  "*.dashlane.com",
  "*.nordpass.com",
  "*.roboform.com",
  "*.chase.com",
  "*.bankofamerica.com",
  "*.wellsfargo.com",
  "*.citi.com",
  "*.capitalone.com",
  "*.usbank.com",
  "*.pnc.com",
  "*.td.com",
  "*.discover.com",
  "*.americanexpress.com",
];
