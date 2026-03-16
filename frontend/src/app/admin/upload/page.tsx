"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Badge,
  Box,
  Button,
  Field,
  Flex,
  Grid,
  Heading,
  Input,
  Progress,
  Select,
  Table,
  Text,
  Portal,
  createListCollection,
} from "@chakra-ui/react";
import { AlertCircle, AlertTriangle, CheckCircle, FolderOpen, Loader, MinusCircle, Upload, X } from "lucide-react";
import api from "@/lib/axios";
import ToastWizard from "@/lib/toastWizard";

// ── Types ──────────────────────────────────────────────────────────────────

interface Dataset { id: number; name: string; }
type FileType = "audio" | "emotion_gender" | "speaker" | "transcription" | "unknown";
type UploadStatus = "ready" | "uploading" | "done" | "skipped" | "error";

interface QueueItem {
  id: string;
  file: File;
  fileType: FileType;
  status: UploadStatus;
  error?: string;
}

interface ExistingFile {
  id: number;
  filename: string;
  json_types: string[];
}

interface FileGroup {
  stem: string;
  audio?:          QueueItem;
  emotion_gender?: QueueItem;
  speaker?:        QueueItem;
  transcription?:  QueueItem;
  status: UploadStatus;
  existingFileId?:   number;
  existingFilename?: string;
}

// Folder mode types
interface ParsedFolderFile {
  file: File;
  subfolder: string;
  detectedType: FileType;
  stem: string;
}

interface SubfolderSummary {
  name: string;
  type: FileType;
  isKnown: boolean;
  count: number;
}

interface FolderGroup {
  stem: string;
  audio?:          ParsedFolderFile;
  emotion_gender?: ParsedFolderFile;
  speaker?:        ParsedFolderFile;
  transcription?:  ParsedFolderFile;
}

interface FolderAnalysis {
  rootFolder: string;
  subfolders: SubfolderSummary[];
  uploadableGroups: FolderGroup[];
  skippedCount: number;
  warnings: string[];
}

// ── Shared helpers ─────────────────────────────────────────────────────────

const LANGUAGE_OPTIONS = createListCollection({
  items: [
    { label: "English", value: "English" },
    { label: "Malay",   value: "Malay" },
    { label: "Chinese", value: "Chinese" },
    { label: "Tamil",   value: "Tamil" },
  ],
});

function detectFileType(filename: string): { type: FileType; stem: string } {
  const name = filename.toLowerCase();
  const ext  = name.split(".").pop() ?? "";
  const base = filename.replace(/\.[^.]+$/, "");

  if (ext === "wav" || ext === "mp3") return { type: "audio", stem: base };
  if (ext === "json") {
    if (base.endsWith("_emotion_gender") || base.endsWith("_emotion"))
      return { type: "emotion_gender", stem: base.replace(/_emotion_gender$/, "").replace(/_emotion$/, "") };
    if (base.endsWith("_speaker"))
      return { type: "speaker", stem: base.replace(/_speaker$/, "") };
    if (base.endsWith("_transcription"))
      return { type: "transcription", stem: base.replace(/_transcription$/, "") };
    return { type: "unknown", stem: base };
  }
  return { type: "unknown", stem: base };
}

function formatBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}

function typeLabel(t: FileType) {
  return ({ audio: "Audio", emotion_gender: "Emotion / Gender", speaker: "Speaker", transcription: "Transcription", unknown: "Unknown" })[t];
}

function typeColor(t: FileType) {
  return ({ audio: "blue", emotion_gender: "purple", speaker: "orange", transcription: "green", unknown: "red" })[t];
}

function statusIcon(s: UploadStatus) {
  if (s === "done")      return <CheckCircle  size={14} color="var(--chakra-colors-green-400)" />;
  if (s === "skipped")   return <MinusCircle  size={14} color="var(--chakra-colors-orange-400)" />;
  if (s === "error")     return <AlertCircle  size={14} color="var(--chakra-colors-red-400)" />;
  if (s === "uploading") return <Loader       size={14} color="var(--chakra-colors-blue-400)" />;
  return null;
}

// ── Files-tab helpers ──────────────────────────────────────────────────────

function groupItems(items: QueueItem[], existingMap: Map<string, ExistingFile>): FileGroup[] {
  const map = new Map<string, FileGroup>();
  for (const item of items) {
    const { stem } = detectFileType(item.file.name);
    const type = item.fileType !== "unknown" ? item.fileType : detectFileType(item.file.name).type;
    if (!map.has(stem)) {
      const existing = existingMap.get(stem);
      map.set(stem, { stem, status: "ready", existingFileId: existing?.id, existingFilename: existing?.filename });
    }
    const g = map.get(stem)!;
    if (type === "audio")          g.audio          = item;
    if (type === "emotion_gender") g.emotion_gender = item;
    if (type === "speaker")        g.speaker        = item;
    if (type === "transcription")  g.transcription  = item;
  }
  return [...map.values()];
}

function isFinished(s: UploadStatus) { return s === "done" || s === "skipped"; }

function groupReady(g: FileGroup): boolean {
  const hasUnuploadedJson = [g.emotion_gender, g.speaker, g.transcription].some(i => i && !isFinished(i.status));
  if (g.audio && isFinished(g.audio.status) && g.existingFileId && hasUnuploadedJson) return true;
  if (g.audio && !isFinished(g.audio.status)) return true;
  if (!g.audio && g.existingFileId && hasUnuploadedJson) return true;
  return false;
}

// ── Folder-tab helpers ─────────────────────────────────────────────────────

const SUBFOLDER_TYPE_MAP: Record<string, FileType> = {
  audio: "audio",
  emotion_gender: "emotion_gender", emotion: "emotion_gender",
  speaker: "speaker", speakers: "speaker",
  transcription: "transcription", transcriptions: "transcription",
};

function parseFolderFiles(files: FileList): FolderAnalysis {
  const parsed: ParsedFolderFile[] = [];

  for (const file of Array.from(files)) {
    const rp = (file as any).webkitRelativePath as string | undefined;
    if (!rp) continue;
    const parts = rp.split("/");
    if (parts.length < 3) continue;
    const subfolder = parts[1].toLowerCase();
    const filename  = parts[parts.length - 1];
    const ext       = filename.split(".").pop()?.toLowerCase() ?? "";
    if (!["wav", "mp3", "json"].includes(ext)) continue;
    const detectedType: FileType = SUBFOLDER_TYPE_MAP[subfolder] ?? "unknown";
    const stem = filename.replace(/\.[^.]+$/, "");
    parsed.push({ file, subfolder, detectedType, stem });
  }

  const rootFolder = parsed.length > 0
    ? ((Array.from(files)[0] as any).webkitRelativePath as string).split("/")[0]
    : "";

  if (parsed.length === 0) {
    return { rootFolder: "", subfolders: [], uploadableGroups: [], skippedCount: 0, warnings: ["No valid files found in the selected folder."] };
  }

  const warnings: string[] = [];

  const sfMap = new Map<string, SubfolderSummary>();
  for (const f of parsed) {
    if (!sfMap.has(f.subfolder)) sfMap.set(f.subfolder, { name: f.subfolder, type: f.detectedType, isKnown: f.detectedType !== "unknown", count: 0 });
    sfMap.get(f.subfolder)!.count++;
  }
  const subfolders = [...sfMap.values()];
  for (const sf of subfolders) {
    if (!sf.isKnown) warnings.push(`Subfolder "${sf.name}" is not recognized — its ${sf.count} file(s) will be skipped`);
  }

  const groupMap = new Map<string, FolderGroup>();
  for (const f of parsed) {
    if (f.detectedType === "unknown") continue;
    if (!groupMap.has(f.stem)) groupMap.set(f.stem, { stem: f.stem });
    const g = groupMap.get(f.stem)!;
    if (f.detectedType === "audio")          g.audio          = f;
    if (f.detectedType === "emotion_gender") g.emotion_gender = f;
    if (f.detectedType === "speaker")        g.speaker        = f;
    if (f.detectedType === "transcription")  g.transcription  = f;
  }

  const allGroups        = [...groupMap.values()];
  const uploadableGroups = allGroups.filter(g => !!g.audio);
  const skippedCount     = allGroups.length - uploadableGroups.length;
  if (skippedCount > 0) warnings.push(`${skippedCount} stem(s) have JSON but no audio and will be skipped`);

  return { rootFolder, subfolders, uploadableGroups, skippedCount, warnings };
}

// ── DropZone ───────────────────────────────────────────────────────────────

function DropZone({ onFiles }: { onFiles: (files: File[]) => void }) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    onFiles([...e.dataTransfer.files]);
  }, [onFiles]);

  return (
    <Box
      borderWidth="2px" borderStyle="dashed" borderColor={dragging ? "blue.400" : "border"}
      bg={dragging ? "blue.900" : "bg.muted"} rounded="lg" p={8} textAlign="center"
      cursor="pointer" transition="all 0.15s"
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
    >
      <input ref={inputRef} type="file" multiple accept=".wav,.mp3,.json" style={{ display: "none" }}
        onChange={(e) => onFiles([...e.target.files!])} />
      <Upload size={28} color="var(--chakra-colors-fg-muted)" style={{ margin: "0 auto 10px" }} />
      <Text color="fg" fontWeight="medium" mb={1}>Drag &amp; drop files here</Text>
      <Text fontSize="sm" color="fg.muted">or click to browse (.wav, .mp3, .json)</Text>
    </Box>
  );
}

// ── LangSelect ─────────────────────────────────────────────────────────────

function LangSelect({ value, onChange, disabled }: { value: string[]; onChange: (v: string[]) => void; disabled?: boolean }) {
  return (
    <Select.Root collection={LANGUAGE_OPTIONS} value={value} onValueChange={(d) => onChange(d.value)} size="sm" disabled={disabled}>
      <Select.HiddenSelect />
      <Select.Control>
        <Select.Trigger bg="bg.muted" borderColor="border" color="fg"><Select.ValueText /></Select.Trigger>
      </Select.Control>
      <Portal>
        <Select.Positioner>
          <Select.Content bg="bg.subtle" borderColor="border">
            {LANGUAGE_OPTIONS.items.map((item) => (
              <Select.Item key={item.value} item={item} color="fg" _hover={{ bg: "bg.muted" }}>{item.label}</Select.Item>
            ))}
          </Select.Content>
        </Select.Positioner>
      </Portal>
    </Select.Root>
  );
}

// ── Constants ──────────────────────────────────────────────────────────────

const JSON_TYPE_OPTIONS = createListCollection({
  items: [
    { label: "Emotion / Gender", value: "emotion_gender" },
    { label: "Speaker",          value: "speaker" },
    { label: "Transcription",    value: "transcription" },
    { label: "Unknown",          value: "unknown" },
  ],
});

const BULK_TYPE_OPTIONS = createListCollection({
  items: [
    { label: "Emotion / Gender", value: "emotion_gender" },
    { label: "Speaker",          value: "speaker" },
    { label: "Transcription",    value: "transcription" },
  ],
});

// ── Page ──────────────────────────────────────────────────────────────────

export default function UploadFilesPage() {
  const [queue,         setQueue]         = useState<QueueItem[]>([]);
  const [language,      setLanguage]      = useState<string[]>(["English"]);
  const [datasetId,     setDatasetId]     = useState<string[]>([]);
  const [uploading,     setUploading]     = useState(false);
  const [existingFiles, setExistingFiles] = useState<ExistingFile[]>([]);
  const [datasets,      setDatasets]      = useState<Dataset[]>([]);
  const [bulkType,      setBulkType]      = useState<string[]>([]);

  const [folderAnalysis,    setFolderAnalysis]    = useState<FolderAnalysis | null>(null);
  const [folderDatasetName, setFolderDatasetName] = useState("");
  const [folderLanguage,    setFolderLanguage]    = useState<string[]>(["English"]);
  const [folderUploading,   setFolderUploading]   = useState(false);
  const [folderProgress,    setFolderProgress]    = useState({ done: 0, total: 0, current: "" });
  const folderInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.get("/api/audio-files").then(r => setExistingFiles(r.data)).catch(() => {});
    api.get("/api/datasets").then(r => setDatasets(r.data)).catch(() => {});
  }, []);

  const existingMap = new Map<string, ExistingFile>();
  for (const f of existingFiles) existingMap.set(f.filename.replace(/\.[^.]+$/, ""), f);

  // ── Queue helpers ─────────────────────────────────────────────────────────

  function addFiles(files: File[]) {
    const newItems: QueueItem[] = files
      .filter(f => ["wav", "mp3", "json"].includes(f.name.split(".").pop()?.toLowerCase() ?? ""))
      .map(f => ({ id: crypto.randomUUID(), file: f, fileType: detectFileType(f.name).type, status: "ready" as UploadStatus }));
    setQueue(prev => {
      const existingAudio = new Set(prev.filter(i => i.fileType === "audio").map(i => i.file.name));
      return [...prev, ...newItems.filter(i => i.fileType !== "audio" || !existingAudio.has(i.file.name))];
    });
  }

  function removeItem(id: string) { setQueue(prev => prev.filter(i => i.id !== id)); }
  function updateItemType(id: string, type: FileType) { setQueue(prev => prev.map(i => i.id === id ? { ...i, fileType: type } : i)); }

  const groups = groupItems(queue, existingMap);

  const updateItemStatus = (ids: string[], status: UploadStatus, error?: string) =>
    setQueue(prev => prev.map(i => ids.includes(i.id) ? { ...i, status, error } : i));

  async function uploadGroup(g: FileGroup) {
    if (!groupReady(g)) return;
    const audioAlreadyDone = g.audio?.status === "done";

    if ((!g.audio || audioAlreadyDone) && g.existingFileId) {
      const jsonSlots = ([
        { item: g.emotion_gender, type: "emotion_gender" },
        { item: g.speaker,        type: "speaker" },
        { item: g.transcription,  type: "transcription" },
      ] as { item: QueueItem | undefined; type: string }[]).filter(({ item }) => !!item && item.status !== "done") as { item: QueueItem; type: string }[];

      for (const { item, type } of jsonSlots) {
        updateItemStatus([item.id], "uploading");
        const fd = new FormData();
        fd.append("json_file", item.file);
        fd.append("json_type", type);
        try {
          await api.post(`/api/audio-files/${g.existingFileId}/json`, fd, { headers: { "Content-Type": "multipart/form-data" } });
          updateItemStatus([item.id], "done");
          setExistingFiles(prev => prev.map(f => f.id === g.existingFileId ? { ...f, json_types: [...new Set([...f.json_types, type])] } : f));
        } catch (e: any) {
          const msg = e?.response?.data?.detail ?? "Link failed.";
          updateItemStatus([item.id], "error", msg);
          ToastWizard.standard("error", "Link failed", `${item.file.name}: ${msg}`, 5000, true);
        }
      }
      ToastWizard.standard("success", "Linked", `JSON(s) linked to ${g.existingFilename ?? g.stem}.`, 3000, true);
      return;
    }

    if (!g.audio) return;
    const ids = [g.audio, g.emotion_gender, g.speaker, g.transcription].filter(Boolean).map(i => i!.id);
    updateItemStatus(ids, "uploading");
    const fd = new FormData();
    fd.append("audio", g.audio.file);
    if (g.emotion_gender) fd.append("emotion_gender_json", g.emotion_gender.file);
    if (g.speaker)        fd.append("speaker_json",        g.speaker.file);
    if (g.transcription)  fd.append("transcription_json",  g.transcription.file);
    fd.append("language", language[0] ?? "");
    if (datasetId[0]) fd.append("dataset_id", datasetId[0]);
    try {
      const res = await api.post("/api/audio-files", fd, { headers: { "Content-Type": "multipart/form-data" } });
      updateItemStatus(ids, "done");
      setExistingFiles(prev => [res.data, ...prev]);
      ToastWizard.standard("success", "Uploaded", `${g.stem} uploaded.`, 3000, true);
    } catch (e: any) {
      const msg = e?.response?.data?.detail ?? "Upload failed.";
      const alreadyExists = typeof msg === "string" && msg.toLowerCase().includes("already exists");
      updateItemStatus(ids, alreadyExists ? "skipped" : "error", msg);
      if (alreadyExists) {
        ToastWizard.standard("warning", "Already exists", `${g.stem} is already in the system — skipped.`, 4000, true);
      } else {
        ToastWizard.standard("error", "Upload failed", `${g.stem}: ${msg}`, 5000, true);
      }
    }
  }

  async function uploadAll() {
    const ready = groups.filter(groupReady);
    if (!ready.length) return;
    setUploading(true);
    await Promise.all(ready.map(uploadGroup));
    setUploading(false);
  }

  function clearDone() { setQueue(prev => prev.filter(i => i.status !== "done" && i.status !== "skipped")); }

  const readyCount   = groups.filter(groupReady).length;
  const linkCount    = groups.filter(g => !g.audio && g.existingFileId && groupReady(g)).length;
  const doneCount    = groups.filter(g => {
    const all = [g.audio, g.emotion_gender, g.speaker, g.transcription].filter(Boolean) as QueueItem[];
    return all.length > 0 && all.every(i => isFinished(i.status));
  }).length;
  const skippedCount = groups.filter(g => {
    const all = [g.audio, g.emotion_gender, g.speaker, g.transcription].filter(Boolean) as QueueItem[];
    return all.length > 0 && all.every(i => isFinished(i.status)) && all.some(i => i.status === "skipped");
  }).length;
  const errorCount   = groups.filter(g => {
    const all = [g.audio, g.emotion_gender, g.speaker, g.transcription].filter(Boolean) as QueueItem[];
    return all.some(i => i.status === "error");
  }).length;

  const unknownItems = queue.filter(i => i.fileType === "unknown");

  // ── Folder handling ───────────────────────────────────────────────────────

  function handleFolderSelect(files: FileList | null) {
    if (!files || files.length === 0) return;
    if (folderInputRef.current) folderInputRef.current.value = "";

    const allPaths = Array.from(files)
      .map(f => (f as any).webkitRelativePath as string ?? "")
      .filter(Boolean);

    if (allPaths.length === 0) {
      addFiles(Array.from(files));
      return;
    }

    const maxDepth = Math.max(...allPaths.map(p => p.split("/").length));

    if (maxDepth <= 2) {
      // Single-level folder — auto-detect type from folder name, add to queue
      const folderName = allPaths[0].split("/")[0].toLowerCase();
      const detectedType: FileType = SUBFOLDER_TYPE_MAP[folderName] ?? "unknown";
      const validFiles = Array.from(files).filter(f =>
        ["wav", "mp3", "json"].includes(f.name.split(".").pop()?.toLowerCase() ?? "")
      );
      const newItems: QueueItem[] = validFiles.map(f => ({
        id: crypto.randomUUID(),
        file: f,
        fileType: detectedType !== "unknown" ? detectedType : detectFileType(f.name).type,
        status: "ready" as UploadStatus,
      }));
      setQueue(prev => [...prev, ...newItems]);
      if (detectedType !== "unknown") {
        ToastWizard.standard("info", `Folder "${folderName}" → ${typeLabel(detectedType)}`, `${newItems.length} files added to queue`, 3000, true);
      } else if (newItems.length > 0) {
        ToastWizard.standard("warning", `Unknown folder type`, `${newItems.length} files added — set their type in the queue`, 4000, true);
      }
    } else {
      // Multi-level — dataset folder mode
      const analysis = parseFolderFiles(files);
      setFolderAnalysis(analysis);
      setFolderDatasetName(analysis.rootFolder);
      setFolderProgress({ done: 0, total: 0, current: "" });
    }
  }

  async function uploadFolderDataset() {
    if (!folderAnalysis || folderAnalysis.uploadableGroups.length === 0) return;
    const dsName = folderDatasetName.trim();
    if (!dsName) { ToastWizard.standard("error", "Dataset name required"); return; }

    setFolderUploading(true);
    setFolderProgress({ done: 0, total: folderAnalysis.uploadableGroups.length, current: "" });
    try {
      let resolvedId: number | null = null;
      const existing = datasets.find(d => d.name.toLowerCase() === dsName.toLowerCase());
      if (existing) {
        resolvedId = existing.id;
      } else {
        const res = await api.post("/api/datasets", { name: dsName });
        resolvedId = res.data.id;
        setDatasets(prev => [...prev, res.data]);
      }

      let done = 0, skipped = 0, errors = 0;
      for (const group of folderAnalysis.uploadableGroups) {
        setFolderProgress(p => ({ ...p, current: group.stem }));
        const fd = new FormData();
        fd.append("audio", group.audio!.file);
        if (group.emotion_gender) fd.append("emotion_gender_json", group.emotion_gender.file);
        if (group.speaker)        fd.append("speaker_json",        group.speaker.file);
        if (group.transcription)  fd.append("transcription_json",  group.transcription.file);
        fd.append("language", folderLanguage[0] ?? "English");
        if (resolvedId) fd.append("dataset_id", String(resolvedId));
        try {
          await api.post("/api/audio-files", fd, { headers: { "Content-Type": "multipart/form-data" } });
          done++;
        } catch (e: any) {
          const detail = e?.response?.data?.detail ?? "";
          if (typeof detail === "string" && detail.toLowerCase().includes("already exists")) skipped++;
          else errors++;
        }
        setFolderProgress({ done: done + skipped + errors, total: folderAnalysis.uploadableGroups.length, current: group.stem });
      }

      const parts: string[] = [];
      if (done    > 0) parts.push(`${done} uploaded`);
      if (skipped > 0) parts.push(`${skipped} already existed`);
      if (errors  > 0) parts.push(`${errors} failed`);
      const summary = parts.join(", ");

      if (errors === 0 && skipped === 0) ToastWizard.standard("success", "Upload complete",   `${summary} to "${dsName}".`);
      else if (errors === 0)             ToastWizard.standard("warning", "Upload complete",    `${summary} — existing files were skipped.`);
      else                               ToastWizard.standard("error",   "Partial upload",     summary);
    } catch (e: any) {
      ToastWizard.standard("error", "Upload failed", e?.response?.data?.detail ?? "Unknown error");
    } finally {
      setFolderUploading(false);
    }
  }

  const folderDatasetExists = datasets.some(d => d.name.toLowerCase() === folderDatasetName.trim().toLowerCase());
  const folderProgressPct   = folderProgress.total > 0 ? Math.round((folderProgress.done / folderProgress.total) * 100) : 0;
  const folderDone          = !folderUploading && folderProgress.total > 0;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <Box p={8} maxW="1100px">
      <Heading size="lg" color="fg" mb={1}>Upload Files</Heading>
      <Text color="fg.muted" mb={6}>
        Add individual files or select a folder.{" "}
        Single-type folders (e.g.{" "}
        <Text as="span" fontFamily="mono" color="fg">emotion_gender/</Text>) auto-tag all files inside.{" "}
        Dataset folders with subfolders open the bulk upload panel below.
      </Text>

      {/* Hidden folder input */}
      <input
        ref={folderInputRef}
        type="file"
        // @ts-ignore
        webkitdirectory=""
        style={{ display: "none" }}
        onChange={e => handleFolderSelect(e.target.files)}
      />

      {/* ── Top section: drop zone + settings ──────────────────────────── */}
      <Grid templateColumns="1fr 280px" gap={6} mb={5}>
        <Box>
          <DropZone onFiles={addFiles} />
          <Flex align="center" gap={2} mt={2} justify="center">
            <Text fontSize="xs" color="fg.muted">or</Text>
            <Button
              size="xs" variant="ghost" color="blue.400"
              onClick={() => folderInputRef.current?.click()}
            >
              <FolderOpen size={12} />
              Select Folder
            </Button>
            <Text fontSize="xs" color="fg.muted">
              (auto-tags by name, or opens bulk panel)
            </Text>
          </Flex>
        </Box>

        <Box bg="bg.subtle" borderWidth="1px" borderColor="border" rounded="lg" p={5}>
          <Text fontSize="sm" fontWeight="semibold" color="fg" mb={4}>Upload Settings</Text>

          <Field.Root mb={4}>
            <Field.Label color="fg" fontSize="sm">Language</Field.Label>
            <LangSelect value={language} onChange={setLanguage} />
          </Field.Root>

          {datasets.length > 0 && (() => {
            const opts = createListCollection({ items: [{ label: "No dataset", value: "" }, ...datasets.map(d => ({ label: d.name, value: String(d.id) }))] });
            return (
              <Field.Root mb={4}>
                <Field.Label color="fg" fontSize="sm">Dataset</Field.Label>
                <Select.Root collection={opts} value={datasetId} onValueChange={(d) => setDatasetId(d.value)} size="sm">
                  <Select.HiddenSelect />
                  <Select.Control>
                    <Select.Trigger bg="bg.muted" borderColor="border" color={datasetId[0] ? "fg" : "fg.muted"}>
                      <Select.ValueText placeholder="None" />
                    </Select.Trigger>
                  </Select.Control>
                  <Portal>
                    <Select.Positioner>
                      <Select.Content bg="bg.subtle" borderColor="border">
                        {opts.items.map(item => (
                          <Select.Item key={item.value} item={item} color="fg" _hover={{ bg: "bg.muted" }}>{item.label}</Select.Item>
                        ))}
                      </Select.Content>
                    </Select.Positioner>
                  </Portal>
                </Select.Root>
              </Field.Root>
            );
          })()}

          <Box bg="bg.muted" rounded="md" p={3} mb={4} fontSize="xs" color="fg.muted">
            <Text mb={1}><Text as="span" color="fg">{readyCount - linkCount}</Text> new uploads</Text>
            {linkCount    > 0 && <Text mb={1}><Text as="span" color="blue.400">{linkCount}</Text> JSON links to existing</Text>}
            {doneCount    > 0 && <Text mb={1}><Text as="span" color="green.400">{doneCount - skippedCount}</Text> done</Text>}
            {skippedCount > 0 && <Text mb={1}><Text as="span" color="orange.400">{skippedCount}</Text> already existed (skipped)</Text>}
            {errorCount   > 0 && <Text><Text as="span" color="red.400">{errorCount}</Text> failed</Text>}
          </Box>

          <Flex direction="column" gap={2}>
            <Button colorPalette="blue" size="sm" w="full" loading={uploading} disabled={readyCount === 0} onClick={uploadAll}>
              <Upload size={14} /> Upload All ({readyCount})
            </Button>
            {queue.length > 0 && <Button variant="outline" size="sm" w="full" onClick={() => setQueue([])}>Clear Queue</Button>}
            {doneCount  > 0 && <Button variant="ghost" size="sm" w="full" color="fg.muted" onClick={clearDone}>Clear Completed</Button>}
          </Flex>
        </Box>
      </Grid>

      {/* ── Hint box ───────────────────────────────────────────────────── */}
      <Box bg="yellow.900" borderWidth="1px" borderColor="yellow.700" rounded="md" px={4} py={3} mb={5} fontSize="xs" color="yellow.200">
        <Text fontWeight="semibold" mb={1}>Upload tips:</Text>
        <Text>• Audio-only upload is valid — annotators create segments manually</Text>
        <Text>• Selecting a folder named <Text as="span" fontFamily="mono">emotion_gender</Text>, <Text as="span" fontFamily="mono">speaker</Text>, <Text as="span" fontFamily="mono">audio</Text>, etc. auto-tags all files inside</Text>
        <Text>• Selecting a dataset root folder (with subfolders) opens the bulk upload panel below</Text>
        <Text>• speaker_0 → speaker_1 (labels shifted +1) when speaker JSON provided</Text>
      </Box>

      {/* ── Bulk type assignment bar ────────────────────────────────────── */}
      {unknownItems.length > 0 && (
        <Flex
          align="center" gap={3} px={4} py={3}
          bg="orange.900" borderWidth="1px" borderColor="orange.700"
          rounded="md" mb={4} flexWrap="wrap"
        >
          <AlertTriangle size={14} color="var(--chakra-colors-orange-400)" />
          <Text fontSize="sm" color="orange.200" flex="1">
            {unknownItems.length} file{unknownItems.length > 1 ? "s" : ""} need a type — assign individually below or bulk-set here
          </Text>
          <Select.Root
            collection={BULK_TYPE_OPTIONS}
            value={bulkType}
            onValueChange={d => setBulkType(d.value)}
            size="sm"
          >
            <Select.HiddenSelect />
            <Select.Control>
              <Select.Trigger bg="bg.muted" borderColor="border" color="fg" minW="160px">
                <Select.ValueText placeholder="Set all to…" />
              </Select.Trigger>
            </Select.Control>
            <Portal>
              <Select.Positioner>
                <Select.Content bg="bg.subtle" borderColor="border">
                  {BULK_TYPE_OPTIONS.items.map(item => (
                    <Select.Item key={item.value} item={item} color="fg" _hover={{ bg: "bg.muted" }}>{item.label}</Select.Item>
                  ))}
                </Select.Content>
              </Select.Positioner>
            </Portal>
          </Select.Root>
          <Button
            size="sm" colorPalette="orange" variant="outline"
            disabled={!bulkType[0]}
            onClick={() => {
              if (!bulkType[0]) return;
              setQueue(prev => prev.map(i => i.fileType === "unknown" ? { ...i, fileType: bulkType[0] as FileType } : i));
              setBulkType([]);
            }}
          >
            Apply to all
          </Button>
        </Flex>
      )}

      {/* ── Queue table ────────────────────────────────────────────────── */}
      {queue.length > 0 && (
        <Box bg="bg.subtle" borderWidth="1px" borderColor="border" rounded="lg" overflow="hidden" mb={6}>
          <Box px={5} py={3} borderBottomWidth="1px" borderColor="border">
            <Text fontSize="sm" fontWeight="semibold" color="fg">Upload Queue — {queue.length} files</Text>
          </Box>
          <Table.Root size="sm">
            <Table.Header>
              <Table.Row>
                {["Filename", "Type", "Size", "Status", ""].map(h => (
                  <Table.ColumnHeader key={h} color="fg.muted" fontSize="xs" px={4} py={3}>{h}</Table.ColumnHeader>
                ))}
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {queue.map(item => {
                const isJson = item.file.name.toLowerCase().endsWith(".json");
                return (
                  <Table.Row key={item.id} _hover={{ bg: "bg.muted" }}>
                    <Table.Cell px={4} py={2}>
                      <Text fontSize="sm" color="fg" fontFamily="mono">{item.file.name}</Text>
                      {item.error && <Text fontSize="xs" color="red.400" mt={0.5}>{item.error}</Text>}
                    </Table.Cell>
                    <Table.Cell px={4} py={2}>
                      {isJson ? (
                        <Select.Root collection={JSON_TYPE_OPTIONS} value={[item.fileType]} onValueChange={d => updateItemType(item.id, d.value[0] as FileType)} size="xs">
                          <Select.HiddenSelect />
                          <Select.Control>
                            <Select.Trigger bg="bg.muted" borderColor={item.fileType === "unknown" ? "red.500" : "border"} color={item.fileType === "unknown" ? "red.400" : "fg"} minW="140px">
                              <Select.ValueText placeholder="Tag type…" />
                            </Select.Trigger>
                          </Select.Control>
                          <Portal>
                            <Select.Positioner>
                              <Select.Content bg="bg.subtle" borderColor="border">
                                {JSON_TYPE_OPTIONS.items.map(opt => (
                                  <Select.Item key={opt.value} item={opt} color="fg" _hover={{ bg: "bg.muted" }}>{opt.label}</Select.Item>
                                ))}
                              </Select.Content>
                            </Select.Positioner>
                          </Portal>
                        </Select.Root>
                      ) : (
                        <Badge colorPalette={typeColor(item.fileType)} size="sm">{typeLabel(item.fileType)}</Badge>
                      )}
                    </Table.Cell>
                    <Table.Cell px={4} py={2}><Text fontSize="xs" color="fg.muted">{formatBytes(item.file.size)}</Text></Table.Cell>
                    <Table.Cell px={4} py={2}>
                      <Flex align="center" gap={1.5}>
                        {statusIcon(item.status)}
                        <Badge colorPalette={
                          item.status === "done"        ? "green"
                          : item.status === "skipped"   ? "orange"
                          : item.status === "error"     ? "red"
                          : item.status === "uploading" ? "blue"
                          : "gray"
                        } size="sm">
                          {item.status === "skipped" ? "exists" : item.status}
                        </Badge>
                      </Flex>
                    </Table.Cell>
                    <Table.Cell px={4} py={2}>
                      {item.status !== "uploading" && (
                        <Button size="xs" variant="ghost" color="fg.muted" p={0} minW="auto" onClick={() => removeItem(item.id)} title="Remove">
                          <X size={14} />
                        </Button>
                      )}
                    </Table.Cell>
                  </Table.Row>
                );
              })}
            </Table.Body>
          </Table.Root>

          {groups.some(g => !g.audio) && (
            <Box px={5} py={3} borderTopWidth="1px" borderColor="border">
              {groups.filter(g => !g.audio && g.existingFileId).map(g => (
                <Text key={g.stem} fontSize="xs" color="blue.300" mb={0.5}>
                  ↗ {g.stem}: will link to <Text as="span" fontFamily="mono">{g.existingFilename}</Text>
                  {existingFiles.find(f => f.id === g.existingFileId)?.json_types?.length
                    ? <Text as="span" color="fg.muted"> (has: {existingFiles.find(f => f.id === g.existingFileId)?.json_types.join(", ")})</Text>
                    : null}
                </Text>
              ))}
              {groups.filter(g => !g.audio && !g.existingFileId).length > 0 && (
                <>
                  <Text fontSize="xs" color="yellow.300" fontWeight="semibold" mb={1} mt={groups.some(g => !g.audio && g.existingFileId) ? 2 : 0}>
                    No matching audio found (will not upload):
                  </Text>
                  {groups.filter(g => !g.audio && !g.existingFileId).map(g => (
                    <Text key={g.stem} fontSize="xs" color="fg.muted">{g.stem}: add the .wav/.mp3 or upload audio first</Text>
                  ))}
                </>
              )}
            </Box>
          )}
        </Box>
      )}

      {/* ── Dataset folder bulk upload ──────────────────────────────────── */}
      <Box>
        {queue.length > 0 && <Box borderTopWidth="1px" borderColor="border" mb={6} />}

        {!folderAnalysis ? (
          <Flex
            align="center" gap={4} p={4}
            bg="bg.subtle" rounded="lg" borderWidth="1px" borderColor="border"
            cursor="pointer" transition="border-color 0.15s"
            _hover={{ borderColor: "blue.500" }}
            onClick={() => folderInputRef.current?.click()}
          >
            <FolderOpen size={22} color="var(--chakra-colors-fg-muted)" style={{ flexShrink: 0 }} />
            <Box flex={1}>
              <Text fontSize="sm" fontWeight="semibold" color="fg">Bulk Dataset Upload</Text>
              <Text fontSize="xs" color="fg.muted">
                Select a root dataset folder containing{" "}
                <Text as="span" fontFamily="mono">audio/</Text>,{" "}
                <Text as="span" fontFamily="mono">emotion_gender/</Text>, etc. to analyse and bulk-upload
              </Text>
            </Box>
            <Button size="sm" colorPalette="blue" variant="outline" pointerEvents="none" flexShrink={0}>
              Select Folder
            </Button>
          </Flex>
        ) : (
          <Box bg="bg.subtle" borderWidth="1px" borderColor="border" rounded="lg" p={5}>
            <Flex justify="space-between" align="center" mb={5}>
              <Text fontWeight="semibold" color="fg">Dataset Folder — {folderAnalysis.rootFolder}</Text>
              <Button size="xs" variant="ghost" color="fg.muted" disabled={folderUploading}
                onClick={() => { setFolderAnalysis(null); if (folderInputRef.current) folderInputRef.current.value = ""; }}>
                <X size={12} /> Change folder
              </Button>
            </Flex>

            <Grid templateColumns="1fr 1fr" gap={4} mb={5}>
              <Field.Root>
                <Field.Label color="fg" fontSize="sm">Dataset Name</Field.Label>
                <Input size="sm" value={folderDatasetName} onChange={e => setFolderDatasetName(e.target.value)}
                  bg="bg.muted" borderColor="border" disabled={folderUploading} />
                <Field.HelperText fontSize="xs" color={folderDatasetName.trim() ? (folderDatasetExists ? "blue.400" : "green.400") : "fg.muted"}>
                  {folderDatasetName.trim()
                    ? (folderDatasetExists ? "Existing dataset — files will be added" : "New dataset will be created")
                    : "Required"}
                </Field.HelperText>
              </Field.Root>
              <Field.Root>
                <Field.Label color="fg" fontSize="sm">Language</Field.Label>
                <LangSelect value={folderLanguage} onChange={setFolderLanguage} disabled={folderUploading} />
              </Field.Root>
            </Grid>

            {/* Subfolder breakdown */}
            <Text fontSize="xs" color="fg.muted" fontWeight="semibold" textTransform="uppercase" letterSpacing="wide" mb={2}>
              Detected Subfolders
            </Text>
            <Box bg="bg.muted" rounded="md" p={3} mb={4}>
              {folderAnalysis.subfolders.length === 0 ? (
                <Text fontSize="sm" color="fg.muted">No valid subfolders detected.</Text>
              ) : (
                folderAnalysis.subfolders.map(sf => (
                  <Flex key={sf.name} align="center" gap={3} mb={1}>
                    {sf.isKnown
                      ? <CheckCircle size={13} color="var(--chakra-colors-green-400)" />
                      : <AlertCircle size={13} color="var(--chakra-colors-red-400)" />}
                    <Text fontSize="sm" fontFamily="mono" color={sf.isKnown ? "fg" : "fg.muted"} minW="160px">{sf.name}/</Text>
                    <Text fontSize="xs" color="fg.muted">→</Text>
                    <Badge colorPalette={sf.isKnown ? typeColor(sf.type) : "red"} size="sm">
                      {sf.isKnown ? typeLabel(sf.type) : "Skipped"}
                    </Badge>
                    <Text fontSize="xs" color="fg.muted">{sf.count} files</Text>
                  </Flex>
                ))
              )}
            </Box>

            {/* Warnings */}
            {folderAnalysis.warnings.length > 0 && (
              <Box mb={4}>
                {folderAnalysis.warnings.map((w, i) => (
                  <Flex key={i} align="flex-start" gap={2} mb={1}>
                    <AlertTriangle size={12} color="var(--chakra-colors-yellow-400)" style={{ marginTop: 2, flexShrink: 0 }} />
                    <Text fontSize="xs" color="yellow.300">{w}</Text>
                  </Flex>
                ))}
              </Box>
            )}

            {/* Summary */}
            <Box bg="bg.muted" rounded="md" p={3} mb={4}>
              <Text fontSize="sm" color="fg">
                <Text as="span" fontWeight="bold" color="blue.400">{folderAnalysis.uploadableGroups.length}</Text>
                {" "}file group{folderAnalysis.uploadableGroups.length !== 1 ? "s" : ""} ready to upload
                {folderAnalysis.skippedCount > 0 && (
                  <Text as="span" color="fg.muted"> · {folderAnalysis.skippedCount} skipped (no audio)</Text>
                )}
              </Text>
            </Box>

            {/* Progress bar */}
            {(folderUploading || folderDone) && (
              <Box mb={4}>
                <Flex justify="space-between" mb={1}>
                  <Text fontSize="xs" color="fg.muted">
                    {folderUploading ? `Uploading: ${folderProgress.current}` : "Upload complete"}
                  </Text>
                  <Text fontSize="xs" color="fg.muted">{folderProgress.done}/{folderProgress.total}</Text>
                </Flex>
                <Progress.Root value={folderProgressPct} size="sm" colorPalette={folderDone ? "green" : "blue"}>
                  <Progress.Track rounded="full"><Progress.Range /></Progress.Track>
                </Progress.Root>
              </Box>
            )}

            <Button
              colorPalette="blue" size="sm"
              loading={folderUploading}
              disabled={folderAnalysis.uploadableGroups.length === 0 || !folderDatasetName.trim() || folderUploading}
              onClick={uploadFolderDataset}
            >
              <Upload size={14} />
              Upload {folderAnalysis.uploadableGroups.length} Group{folderAnalysis.uploadableGroups.length !== 1 ? "s" : ""}
            </Button>
          </Box>
        )}
      </Box>
    </Box>
  );
}
