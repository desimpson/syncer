import { GoogleOAuth2Service, GoogleTasksService } from "@/services";
import type { SyncJobCreator } from "@/integrations/types";
import { generateSyncActions } from "@/sync/actions";
import { readMarkdownSyncItems } from "@/sync/reader";
import { writeSyncActions } from "@/sync/writer";
import { mapGoogleTaskToSyncItem } from "@/integrations/google-tasks/adaptor";
import { GOOGLE_TASKS_SOURCE } from "@/integrations/google-tasks/constants";
import type { PluginConfig, GoogleTasksSettings, PluginSettings } from "@/plugin/types";
import type { TFile, Vault } from "obsidian";
import type { GoogleTask } from "@/services/google/types";

const ensureAccessToken = async (
  googleTasks: GoogleTasksSettings,
  config: PluginConfig,
  persist: (update: { accessToken: string; expiresIn: number }) => Promise<void>,
): Promise<string> => {
  const { token } = googleTasks;

  if (token.expiresIn < Date.now()) {
    console.info("Google Tasks token has expired. Refreshing...");
    const { accessToken, expiresIn } = await GoogleOAuth2Service.refreshAccessToken(
      config.googleClientId,
      config.googleClientSecret,
      token.refreshToken,
    );

    await persist({ accessToken, expiresIn });
    console.info("Saved refreshed Google Tasks token.");
    return accessToken;
  }

  return token.accessToken;
};

const getSyncFileOrNotify = (
  vault: Vault,
  syncDocument: string,
  notify: (message: string) => void,
) => {
  const file = vault.getFileByPath(syncDocument);
  if (file === null) {
    notify(`Sync document "${syncDocument}" not found. Please update settings or create the file.`);
    console.warn(`Sync document [${syncDocument}] not found. Aborting sync.`);
    return undefined;
  }
  return file;
};

const fetchAllSelectedTasks = async (accessToken: string, selectedListIds: readonly string[]) => {
  const fetchTasks = GoogleTasksService.createGoogleTasksFetcher(accessToken);
  const fetchedTasks = await Promise.all(selectedListIds.map(fetchTasks));
  return fetchedTasks.flat();
};

const syncTasksToFile = async (
  file: TFile,
  tasks: readonly GoogleTask[],
  syncHeading: string,
  syncDocument: string,
  notify: (message: string) => void,
) => {
  const adaptor = mapGoogleTaskToSyncItem(syncHeading);
  const incoming = tasks.map(adaptor);
  console.info(`Mapped incoming Google Tasks to sync items: [${incoming.length}] items.`);

  try {
    const existing = await readMarkdownSyncItems(file, GOOGLE_TASKS_SOURCE);
    console.info(`Read existing Google Tasks Markdown items: [${existing.length}] items.`);

    const actions = generateSyncActions(incoming, existing);
    console.info(`Generated [${actions.length}] sync actions.`);

    await writeSyncActions(file, actions, syncHeading);
    console.info(`Applied [${actions.length}] Google Tasks sync actions to the Markdown note.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/ENOENT|no such file or directory|not found/i.test(message)) {
      notify(
        `Sync document "${syncDocument}" is missing on disk. Please recreate it or update settings.`,
      );
      console.error(`File missing during sync: [${message}]. Aborting sync.`);
      return;
    }
    throw error;
  }
};

/**
 * Create a job to sync Google Tasks into a Markdown note.
 *
 * @param loadSettings - Function that returns the current plugin settings
 * @param saveSettings - Function to persist updated plugin settings to storage,
 *                       accepting a `PluginSettings` object
 * @param config - The plugin configuration
 * @param vault - A `Vault`-like object to access files
 * @param notify - Function to display user-facing messages
 * @returns A `SyncJob` that can be scheduled
 */
export const createGoogleTasksJob: SyncJobCreator = (
  loadSettings,
  saveSettings,
  config,
  vault,
  notify,
) => ({
  name: GOOGLE_TASKS_SOURCE,
  task: async () => {
    console.info("Starting Google Tasks sync job...");

    // TODO: Test settings freshness?
    const settings = await loadSettings();
    const { googleTasks, syncDocument, syncHeading } = settings;
    if (googleTasks === undefined) {
      console.info("No Google Tasks configured.");
      return;
    }

    if (googleTasks.selectedListIds.length === 0) {
      console.info("No Google Tasks lists selected.");
      return;
    }

    const currentAccessToken = await ensureAccessToken(
      googleTasks,
      config,
      async ({ accessToken, expiresIn }) => {
        const updatedSettings: PluginSettings = {
          ...settings,
          googleTasks: {
            ...googleTasks,
            token: { ...googleTasks.token, accessToken, expiresIn },
          },
        };
        console.info("Updated Google Tasks token in memory.");
        await saveSettings(updatedSettings);
      },
    );

    // Read the Markdown file
    const file = getSyncFileOrNotify(vault, syncDocument, notify);
    if (file === undefined) {
      console.error(`Sync document [${syncDocument}] not found.`);
      return;
    }

    // Fetch tasks from Google Tasks
    const tasks = await fetchAllSelectedTasks(currentAccessToken, googleTasks.selectedListIds);
    console.info(`Fetched [${tasks.length}] tasks from Google Tasks.`);

    // Convert and sync
    await syncTasksToFile(file, tasks, syncHeading, syncDocument, notify);
  },
});
