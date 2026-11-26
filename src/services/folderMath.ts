import type { ScanDocument } from '../types';

export interface FolderEntry {
  id: string;
  label: string;
  isDefault: boolean;
}

export const DEFAULT_FOLDER_ENTRIES: FolderEntry[] = [
  { id: 'Scans', label: 'New Docs', isDefault: true },
  { id: 'ID_Cards', label: 'ID Cards', isDefault: true },
  { id: 'Receipts', label: 'Receipts', isDefault: true },
  { id: 'PDFs', label: 'PDF Files', isDefault: true },
];

export interface FolderPrefs {
  customFolders: string[];
  renamedLabels: Record<string, string>;
  hiddenDefaults: string[];
}

export const EMPTY_FOLDER_PREFS: FolderPrefs = {
  customFolders: [],
  renamedLabels: {},
  hiddenDefaults: [],
};

export function buildFolderEntries(prefs: FolderPrefs): FolderEntry[] {
  const defaults = DEFAULT_FOLDER_ENTRIES.filter(
    (d) => !prefs.hiddenDefaults.includes(d.id)
  ).map((d) => ({
    ...d,
    label: prefs.renamedLabels[d.id] || d.label,
  }));

  const customs: FolderEntry[] = prefs.customFolders.map((id) => ({
    id,
    label: prefs.renamedLabels[id] || id,
    isDefault: false,
  }));

  return [...defaults, ...customs];
}

export function createFolderInPrefs(prefs: FolderPrefs, rawName: string): {
  nextPrefs: FolderPrefs;
  createdId: string | null;
} {
  const cleanLabel = rawName.trim();
  if (!cleanLabel) return { nextPrefs: prefs, createdId: null };

  const existing = buildFolderEntries(prefs);
  const dup = existing.find(
    (f) => f.label.toLowerCase() === cleanLabel.toLowerCase() || f.id.toLowerCase() === cleanLabel.toLowerCase()
  );
  if (dup) {
    return { nextPrefs: prefs, createdId: dup.id };
  }

  return {
    nextPrefs: {
      ...prefs,
      customFolders: [...prefs.customFolders, cleanLabel],
    },
    createdId: cleanLabel,
  };
}

export function renameFolderInPrefs(
  prefs: FolderPrefs,
  folderId: string,
  rawNewLabel: string
): FolderPrefs {
  const nextLabel = rawNewLabel.trim();
  if (!nextLabel) return prefs;

  return {
    ...prefs,
    renamedLabels: {
      ...prefs.renamedLabels,
      [folderId]: nextLabel,
    },
  };
}

export function deleteFolderFromPrefs(
  prefs: FolderPrefs,
  folderId: string
): FolderPrefs {
  const isDefault = DEFAULT_FOLDER_ENTRIES.some((d) => d.id === folderId);
  const nextRenamed = { ...prefs.renamedLabels };
  delete nextRenamed[folderId];

  if (isDefault) {
    return {
      ...prefs,
      hiddenDefaults: prefs.hiddenDefaults.includes(folderId)
        ? prefs.hiddenDefaults
        : [...prefs.hiddenDefaults, folderId],
      renamedLabels: nextRenamed,
    };
  }

  return {
    ...prefs,
    customFolders: prefs.customFolders.filter((f) => f !== folderId),
    renamedLabels: nextRenamed,
  };
}

export function countDocsInFolder(documents: ScanDocument[], folderId: string): number {
  return documents.filter(
    (d) => d.category === folderId || d.folder === folderId || d.folder.endsWith(`/${folderId}`)
  ).length;
}
