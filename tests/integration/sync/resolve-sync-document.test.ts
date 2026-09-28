import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { TFile, Vault } from "obsidian";
import {
  formatSyncDocumentMissingOnDiskNotice,
  formatSyncDocumentNotFoundNotice,
  getSyncDocumentWithRetry,
  isSyncDocumentMissingFileError,
  notifyIfSyncDocumentUnavailable,
  resolveReadableSyncDocument,
} from "@/sync/resolve-sync-document";

const makeFile = (path = "GTD.md"): TFile => ({ path, name: path }) as unknown as TFile;

/**
 * Missing sync document repro matrix (#33):
 * - Missing path, token valid → not-found Notice; no refresh, no fetch
 * - Missing path, token expired → not-found Notice; no refresh; credentials kept
 * - Stale handle (read ENOENT), token valid → missing-on-disk Notice; no fetch
 * - Stale handle, token expired → missing-on-disk Notice; no refresh
 * - Readable at start, missing when fetch rejects → missing-on-disk Notice; return
 * - Readable before and after network rejection → rethrow (connectivity UI is #34)
 */
describe("resolve-sync-document", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("formatSyncDocumentNotFoundNotice matches the job not-found sentence", () => {
    expect(formatSyncDocumentNotFoundNotice("Inbox.md")).toBe(
      'Sync document "Inbox.md" not found. Please update settings or create the file.',
    );
  });

  it("formatSyncDocumentMissingOnDiskNotice matches the job missing-on-disk sentence", () => {
    expect(formatSyncDocumentMissingOnDiskNotice("Inbox.md")).toBe(
      'Sync document "Inbox.md" is missing on disk. Please recreate it or update settings.',
    );
  });

  it("isSyncDocumentMissingFileError matches ENOENT-style messages", () => {
    expect(isSyncDocumentMissingFileError("ENOENT: no such file or directory")).toBe(true);
    expect(isSyncDocumentMissingFileError("Resource not found")).toBe(true);
    expect(isSyncDocumentMissingFileError("Network offline")).toBe(false);
  });

  it("notifies once when path stays missing across the vault-init retry", async () => {
    // Arrange
    const notify = vi.fn();
    const vault = {
      // eslint-disable-next-line unicorn/no-null -- Obsidian vault.getFileByPath returns null when missing
      getFileByPath: vi.fn().mockReturnValue(null),
    } as unknown as Vault;

    // Act
    const resultPromise = getSyncDocumentWithRetry(vault, "Missing.md", notify);
    await vi.advanceTimersByTimeAsync(500);
    const result = await resultPromise;

    // Assert
    expect(result).toBeUndefined();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(formatSyncDocumentNotFoundNotice("Missing.md"));
  });

  it("returns the file when the retry finds the path", async () => {
    // Arrange
    const file = makeFile();
    const getFileByPath = vi
      .fn()
      // eslint-disable-next-line unicorn/no-null -- Obsidian vault.getFileByPath returns null when missing
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(file);
    const vault = { getFileByPath } as unknown as Vault;

    // Act
    const resultPromise = getSyncDocumentWithRetry(vault, "GTD.md", vi.fn());
    await vi.advanceTimersByTimeAsync(500);
    const result = await resultPromise;

    // Assert
    expect(result).toBe(file);
  });
});

describe("resolveReadableSyncDocument", () => {
  it("returns the file when vault.read succeeds", async () => {
    // Arrange
    const file = makeFile();
    const vault = {
      getFileByPath: vi.fn().mockReturnValue(file),
      read: vi.fn().mockResolvedValue("note body"),
      cachedRead: vi.fn().mockResolvedValue("stale cache"),
    } as unknown as Vault;

    // Act
    const result = await resolveReadableSyncDocument(vault, "GTD.md", vi.fn());

    // Assert
    expect(result).toBe(file);
    expect(vault.read).toHaveBeenCalledWith(file);
    expect(vault.cachedRead).not.toHaveBeenCalled();
  });

  it("notifies missing-on-disk when read throws ENOENT even if cachedRead would succeed", async () => {
    // Arrange
    const notify = vi.fn();
    const file = makeFile();
    const vault = {
      getFileByPath: vi.fn().mockReturnValue(file),
      read: vi.fn().mockRejectedValue(new Error("ENOENT: no such file or directory")),
      cachedRead: vi.fn().mockResolvedValue("stale cache"),
    } as unknown as Vault;

    // Act
    const result = await resolveReadableSyncDocument(vault, "GTD.md", notify);

    // Assert
    expect(result).toBeUndefined();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(formatSyncDocumentMissingOnDiskNotice("GTD.md"));
    expect(vault.cachedRead).not.toHaveBeenCalled();
  });
});

describe("notifyIfSyncDocumentUnavailable", () => {
  it("returns false when vault.read succeeds after a network failure", async () => {
    // Arrange
    const file = makeFile();
    const vault = {
      getFileByPath: vi.fn().mockReturnValue(file),
      read: vi.fn().mockResolvedValue(""),
    } as unknown as Vault;

    // Act
    const notified = await notifyIfSyncDocumentUnavailable(vault, "GTD.md", vi.fn());

    // Assert
    expect(notified).toBe(false);
  });

  it("notifies once per call when the sync note is missing on disk", async () => {
    // Arrange
    const notify = vi.fn();
    const file = makeFile();
    const vault = {
      getFileByPath: vi.fn().mockReturnValue(file),
      read: vi.fn().mockRejectedValue(new Error("ENOENT: no such file or directory")),
    } as unknown as Vault;

    // Act
    const notified = await notifyIfSyncDocumentUnavailable(vault, "GTD.md", notify);

    // Assert
    expect(notified).toBe(true);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(formatSyncDocumentMissingOnDiskNotice("GTD.md"));
  });
});
