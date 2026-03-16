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
  Tabs,
  Text,
  Portal,
  createListCollection,
} from "@chakra-ui/react";
import {
  AlertCircle, AlertTriangle, CheckCircle, FolderOpen,
  Link2, Loader, MinusCircle, Upload, X,
} from "lucide-react";
import api from "@/lib/axios";
import ToastWizard from "@/lib/toastWizard";

// ── Types ──────────────────────────────────────────────────────────────────

interface Dataset { id: number; name: string; }
type FileType = "audio" | "emotion_gender" | "speaker" | "transcription" | "unknown";
type UploadStatus = "ready" | "uploading" | "done" | "skipped" | "error";
type FolderMode = "dataset" | "single_type";

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

interface SingleTypeMatch {
  stem: string;
  file: File;
  existingFileId: number;
  existingFilename: string;
}

interface FolderAnalysis {
  rootFolder: string;
  mode: FolderMode;
  // dataset mode
  subfolders: SubfolderSummary[];
  uploadableGroups: FolderGroup[];
  datasetSkippedCount: number;
  // single_type mode
  singleType: FileType | null;
  matches: SingleTypeMatch[];
  unmatched: string[];
  warnings: string[];
}

// ── Shared helpers ─────────────────────────────────────────────────────────

const SUBFOLDER_TYPE_MAP: Record<string, FileType> = {
  audio: "audio",
  emotion_gender: "emotion_gender", emotion: "emotion_gender",
  speaker: "speaker", speakers: "speaker",
  transcription: "transcription", transcriptions: "transcription",
};

const LANGUAGE_PRESETS = ["English", "Malay", "Chinese", "Tamil", "Mixed"];

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

// ── Queue helpers ──────────────────────────────────────────────────────────

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

// ── Folder analysis ────────────────────────────────────────────────────────

function parseFolderFiles(files: FileList, existingMap: Map<string, ExistingFile>): FolderAnalysis {
  const allFiles = Array.from(files);

  // Determine root folder name from webkitRelativePath
  const firstWithPath = allFiles.find(f => (f as any).webkitRelativePath);
  const rootFolder = firstWithPath
    ? ((firstWithPath as any).webkitRelativePath as string).split("/")[0]
    : "Unknown";

  const parsed: ParsedFolderFile[] = [];

  for (const file of allFiles) {
    const rp = (file as any).webkitRelativePath as string | undefined;
    if (!rp) continue;
    const parts = rp.split("/");
    const filename = parts[parts.length - 1];
    const ext = filename.split(".").pop()?.toLowerCase() ?? "";
    if (!["wav", "mp3", "json"].includes(ext)) continue;

    let subfolder: string;
    if (parts.length >= 3) {
      // dataset mode: rootfolder/subfolder/file
      subfolder = parts[1].toLowerCase();
    } else if (parts.length === 2) {
      // single-type mode: typefolder/file — root folder IS the type
      subfolder = parts[0].toLowerCase();
    } else {
      continue;
    }

    const detectedType: FileType = SUBFOLDER_TYPE_MAP[subfolder] ?? "unknown";
    // Use detectFileType stem to strip known JSON suffixes (_emotion, _speaker, etc.)
    const stem = detectFileType(filename).stem;
    parsed.push({ file, subfolder, detectedType, stem });
  }

  const emptyResult = (warnings: string[]): FolderAnalysis => ({
    rootFolder, mode: "dataset",
    subfolders: [], uploadableGroups: [], datasetSkippedCount: 0,
    singleType: null, matches: [], unmatched: [],
    warnings,
  });

  if (parsed.length === 0) {
    return emptyResult(["No valid audio or JSON files found. Make sure you selected the correct folder."]);
  }

  // Detect mode: single-type = root folder name is a recognised type AND no depth-3 paths
  const hasDepth3 = allFiles.some(f => {
    const rp = (f as any).webkitRelativePath as string;
    return rp && rp.split("/").length >= 3;
  });
  const rootType = SUBFOLDER_TYPE_MAP[rootFolder.toLowerCase()];
  const isSingleType = !hasDepth3 && rootType !== undefined && rootType !== "audio";

  if (isSingleType) {
    const matches: SingleTypeMatch[] = [];
    const unmatched: string[] = [];
    for (const p of parsed) {
      if (p.detectedType === "unknown") continue;
      const ex = existingMap.get(p.stem);
      if (ex) {
        matches.push({ stem: p.stem, file: p.file, existingFileId: ex.id, existingFilename: ex.filename });
      } else {
        unmatched.push(p.stem);
      }
    }
    const warnings: string[] = [];
    if (unmatched.length > 0)
      warnings.push(`${unmatched.length} file(s) have no matching audio in the system and will be skipped`);
    return {
      rootFolder, mode: "single_type",
      subfolders: [], uploadableGroups: [], datasetSkippedCount: 0,
      singleType: rootType, matches, unmatched,
      warnings,
    };
  }

  // Dataset mode
  const warnings: string[] = [];
  const sfMap = new Map<string, SubfolderSummary>();
  for (const f of parsed) {
    if (!sfMap.has(f.subfolder)) sfMap.set(f.subfolder, { name: f.subfolder, type: f.detectedType, isKnown: f.detectedType !== "unknown", count: 0 });
    sfMap.get(f.subfolder)!.count++;
  }
  const subfolders = [...sfMap.values()];
  for (const sf of subfolders) {
    if (!sf.isKnown) warnings.push(`Subfolder "${sf.name}" is not recognised — its files will be skipped`);
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
  const datasetSkippedCount = allGroups.length - uploadableGroups.length;
  if (datasetSkippedCount > 0)
    warnings.push(`${datasetSkippedCount} stem(s) have JSON but no audio — they will be skipped`);

  return {
    rootFolder, mode: "dataset",
    subfolders, uploadableGroups, datasetSkippedCount,
    singleType: null, matches: [], unmatched: [],
    warnings,
  };
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
      <Text fontSize="sm" color="fg.muted">or click to browse — .wav, .mp3, .json accepted</Text>
    </Box>
  );
}

// ── LangInput ─────────────────────────────────────────────────────────────

function LangInput({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <>
      <Input
        list="lang-presets"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="e.g. English, Mixed, Hokkien…"
        bg="bg.muted" borderColor="border" color="fg" size="sm"
        disabled={disabled}
      />
      <datalist id="lang-presets">
        {LANGUAGE_PRESETS.map(l => <option key={l} value={l} />)}
      </datalist>
    </>
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
  // ── Files tab state ───────────────────────────────────────────────────
  const [queue,         setQueue]         = useState<QueueItem[]>([]);
  const [language,      setLanguage]      = useState("English");
  const [datasetId,     setDatasetId]     = useState<string[]>([]);
  const [uploading,     setUploading]     = useState(false);
  const [existingFiles, setExistingFiles] = useState<ExistingFile[]>([]);
  const [datasets,      setDatasets]      = useState<Dataset[]>([]);
  const [bulkType,      setBulkType]      = useState<string[]>([]);

  // ── Folder tab state ──────────────────────────────────────────────────
  const [folderAnalysis,    setFolderAnalysis]    = useState<FolderAnalysis | null>(null);
  const [folderDatasetName, setFolderDatasetName] = useState("");
  const [folderLanguage,    setFolderLanguage]    = useState("English");
  const [folderUploading,   setFolderUploading]   = useState(false);
  const [folderProgress,    setFolderProgress]    = useState({ done: 0, total: 0, current: "" });
  // single_type results per-row status
  const [singleResults,     setSingleResults]     = useState<Record<string, UploadStatus>>({});

  useEffect(() => {
    api.get("/api/audio-files").then(r => setExistingFiles(r.data)).catch(() => {});
    api.get("/api/datasets").then(r => setDatasets(r.data)).catch(() => {});
  }, []);

  const existingMap = new Map<string, ExistingFile>();
  for (const f of existingFiles) existingMap.set(f.filename.replace(/\.[^.]+$/, ""), f);

  // ── Queue helpers ─────────────────────────────────────────────────────

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

    if ((!g.audio || isFinished(g.audio.status)) && g.existingFileId) {
      const jsonSlots = ([
        { item: g.emotion_gender, type: "emotion_gender" },
        { item: g.speaker,        type: "speaker" },
        { item: g.transcription,  type: "transcription" },
      ] as { item: QueueItem | undefined; type: string }[]).filter(({ item }) => !!item && !isFinished(item.status)) as { item: QueueItem; type: string }[];

      for (const { item, type } of jsonSlots) {
        updateItemStatus([item.id], "uploading");
        const fd = new FormData();
        fd.append("json_file", item.file);
        fd.append("json_type", type);
        try {
          await api.post(`/api/audio-files/${g.existingFileId}/json`, fd, { headers: { "Content-Type": undefined } });
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
    fd.append("language", language.trim());
    if (datasetId[0]) fd.append("dataset_id", datasetId[0]);
    try {
      const res = await api.post("/api/audio-files", fd, { headers: { "Content-Type": undefined } });
      updateItemStatus(ids, "done");
      setExistingFiles(prev => [res.data, ...prev]);
      ToastWizard.standard("success", "Uploaded", `${g.stem} uploaded.`, 3000, true);
    } catch (e: any) {
      const msg = e?.response?.data?.detail ?? "Upload failed.";
      const alreadyExists = typeof msg === "string" && msg.toLowerCase().includes("already exists");
      updateItemStatus(ids, alreadyExists ? "skipped" : "error", msg);
      if (alreadyExists) ToastWizard.standard("warning", "Already exists", `${g.stem} skipped.`, 4000, true);
      else ToastWizard.standard("error", "Upload failed", `${g.stem}: ${msg}`, 5000, true);
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

  // ── Folder upload ─────────────────────────────────────────────────────

  function handleFolderSelect(files: FileList | null) {
    if (!files || files.length === 0) return;
    const analysis = parseFolderFiles(files, existingMap);
    setFolderAnalysis(analysis);
    setFolderDatasetName(analysis.mode === "dataset" ? analysis.rootFolder : "");
    setFolderProgress({ done: 0, total: 0, current: "" });
    setSingleResults({});
  }

  // Dataset mode upload
  async function uploadFolderDataset() {
    if (!folderAnalysis || folderAnalysis.mode !== "dataset" || folderAnalysis.uploadableGroups.length === 0) return;
    const dsName = folderDatasetName.trim();
    if (!dsName) { ToastWizard.standard("error", "Dataset name required", "Please enter a dataset name."); return; }

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
        fd.append("language", folderLanguage.trim() || "English");
        if (resolvedId) fd.append("dataset_id", String(resolvedId));
        try {
          await api.post("/api/audio-files", fd, { headers: { "Content-Type": undefined } });
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

      if (errors === 0 && skipped === 0) ToastWizard.standard("success", "Upload complete", `${summary} to "${dsName}".`);
      else if (errors === 0)             ToastWizard.standard("warning", "Upload complete", `${summary} — duplicates skipped.`);
      else                               ToastWizard.standard("error",   "Partial upload",  summary);
    } catch (e: any) {
      ToastWizard.standard("error", "Upload failed", e?.response?.data?.detail ?? "Unknown error");
    } finally {
      setFolderUploading(false);
    }
  }

  // Single-type mode upload (link JSONs to existing audio)
  async function uploadSingleTypeFolder() {
    if (!folderAnalysis || folderAnalysis.mode !== "single_type" || folderAnalysis.matches.length === 0) return;
    const jsonType = folderAnalysis.singleType!;

    setFolderUploading(true);
    const initResults: Record<string, UploadStatus> = {};
    for (const m of folderAnalysis.matches) initResults[m.stem] = "ready";
    setSingleResults(initResults);
    setFolderProgress({ done: 0, total: folderAnalysis.matches.length, current: "" });

    let done = 0, errors = 0;
    for (const match of folderAnalysis.matches) {
      setSingleResults(prev => ({ ...prev, [match.stem]: "uploading" }));
      setFolderProgress(p => ({ ...p, current: match.stem }));
      const fd = new FormData();
      fd.append("json_file", match.file);
      fd.append("json_type", jsonType);
      try {
        await api.post(`/api/audio-files/${match.existingFileId}/json`, fd, { headers: { "Content-Type": undefined } });
        done++;
        setSingleResults(prev => ({ ...prev, [match.stem]: "done" }));
      } catch {
        errors++;
        setSingleResults(prev => ({ ...prev, [match.stem]: "error" }));
      }
      setFolderProgress({ done: done + errors, total: folderAnalysis.matches.length, current: match.stem });
    }

    setFolderUploading(false);
    if (errors === 0) ToastWizard.standard("success", "Link complete", `${done} ${typeLabel(jsonType)} file(s) linked to existing audio.`);
    else              ToastWizard.standard("warning", "Partial link",  `${done} linked, ${errors} failed.`);
  }

  const folderDatasetExists = datasets.some(d => d.name.toLowerCase() === folderDatasetName.trim().toLowerCase());
  const folderProgressPct   = folderProgress.total > 0 ? Math.round((folderProgress.done / folderProgress.total) * 100) : 0;
  const folderDone          = !folderUploading && folderProgress.total > 0;

  // ── Dataset options ───────────────────────────────────────────────────
  const datasetOpts = createListCollection({
    items: [{ label: "No dataset", value: "" }, ...datasets.map(d => ({ label: d.name, value: String(d.id) }))],
  });

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <Box p={8} maxW="1100px">
      <Heading size="lg" color="fg" mb={1}>Upload Files</Heading>
      <Text color="fg.muted" mb={6}>
        Use the <Text as="span" fontWeight="semibold" color="fg">Files</Text> tab for individual files.
        Use the <Text as="span" fontWeight="semibold" color="fg">Folder</Text> tab for bulk dataset or single-type folder uploads.
      </Text>

      <Tabs.Root defaultValue="files" variant="line">
        <Tabs.List borderBottomWidth="1px" borderColor="border" mb={6}>
          <Tabs.Trigger value="files" color="fg.muted" _selected={{ color: "blue.400", borderColor: "blue.400" }}>
            <Upload size={14} style={{ marginRight: 6 }} /> Files
          </Tabs.Trigger>
          <Tabs.Trigger value="folder" color="fg.muted" _selected={{ color: "blue.400", borderColor: "blue.400" }}>
            <FolderOpen size={14} style={{ marginRight: 6 }} /> Folder
          </Tabs.Trigger>
        </Tabs.List>

        {/* ── FILES TAB ────────────────────────────────────────────── */}
        <Tabs.Content value="files">
          <Grid templateColumns="1fr 280px" gap={6} mb={5}>
            <Box>
              <DropZone onFiles={addFiles} />
              <Box bg="yellow.900" borderWidth="1px" borderColor="yellow.700" rounded="md" px={4} py={3} mt={3} fontSize="xs" color="yellow.200">
                <Text fontWeight="semibold" mb={1}>Tips</Text>
                <Text>• Audio-only upload is valid — annotators create segments manually</Text>
                <Text>• JSON files are auto-tagged from their filename suffix (_emotion_gender, _speaker, _transcription)</Text>
                <Text>• JSONs without a matching suffix show as "Unknown" — tag them manually below</Text>
                <Text>• speaker_0 → speaker_1 (labels shifted +1) when speaker JSON is provided</Text>
              </Box>
            </Box>

            <Box bg="bg.subtle" borderWidth="1px" borderColor="border" rounded="lg" p={5}>
              <Text fontSize="sm" fontWeight="semibold" color="fg" mb={4}>Upload Settings</Text>

              <Field.Root mb={4}>
                <Field.Label color="fg" fontSize="sm">Language</Field.Label>
                <LangInput value={language} onChange={setLanguage} />
              </Field.Root>

              {datasets.length > 0 && (
                <Field.Root mb={4}>
                  <Field.Label color="fg" fontSize="sm">Dataset</Field.Label>
                  <Select.Root collection={datasetOpts} value={datasetId} onValueChange={(d) => setDatasetId(d.value)} size="sm">
                    <Select.HiddenSelect />
                    <Select.Control>
                      <Select.Trigger bg="bg.muted" borderColor="border" color={datasetId[0] ? "fg" : "fg.muted"}>
                        <Select.ValueText placeholder="None" />
                      </Select.Trigger>
                    </Select.Control>
                    <Portal>
                      <Select.Positioner>
                        <Select.Content bg="bg.subtle" borderColor="border">
                          {datasetOpts.items.map(item => (
                            <Select.Item key={item.value} item={item} color="fg" _hover={{ bg: "bg.muted" }}>{item.label}</Select.Item>
                          ))}
                        </Select.Content>
                      </Select.Positioner>
                    </Portal>
                  </Select.Root>
                </Field.Root>
              )}

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
                {doneCount > 0 && <Button variant="ghost" size="sm" w="full" color="fg.muted" onClick={clearDone}>Clear Completed</Button>}
              </Flex>
            </Box>
          </Grid>

          {/* Bulk type bar */}
          {unknownItems.length > 0 && (
            <Flex align="center" gap={3} px={4} py={3} bg="orange.900" borderWidth="1px" borderColor="orange.700" rounded="md" mb={4} flexWrap="wrap">
              <AlertTriangle size={14} color="var(--chakra-colors-orange-400)" />
              <Text fontSize="sm" color="orange.200" flex="1">
                {unknownItems.length} file{unknownItems.length > 1 ? "s" : ""} need a type — assign individually or bulk-set here
              </Text>
              <Select.Root collection={BULK_TYPE_OPTIONS} value={bulkType} onValueChange={d => setBulkType(d.value)} size="sm">
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
              <Button size="sm" colorPalette="orange" variant="outline" disabled={!bulkType[0]}
                onClick={() => {
                  if (!bulkType[0]) return;
                  setQueue(prev => prev.map(i => i.fileType === "unknown" ? { ...i, fileType: bulkType[0] as FileType } : i));
                  setBulkType([]);
                }}>
                Apply to all
              </Button>
            </Flex>
          )}

          {/* Queue table */}
          {queue.length > 0 ? (
            <Box bg="bg.subtle" borderWidth="1px" borderColor="border" rounded="lg" overflow="hidden">
              <Box px={5} py={3} borderBottomWidth="1px" borderColor="border">
                <Text fontSize="sm" fontWeight="semibold" color="fg">Upload Queue — {queue.length} file{queue.length !== 1 ? "s" : ""}</Text>
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
                              item.status === "done" ? "green" : item.status === "skipped" ? "orange"
                              : item.status === "error" ? "red" : item.status === "uploading" ? "blue" : "gray"
                            } size="sm">
                              {item.status === "skipped" ? "exists" : item.status}
                            </Badge>
                          </Flex>
                        </Table.Cell>
                        <Table.Cell px={4} py={2}>
                          {item.status !== "uploading" && (
                            <Button size="xs" variant="ghost" color="fg.muted" p={0} minW="auto" onClick={() => removeItem(item.id)}>
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
                    </Text>
                  ))}
                  {groups.filter(g => !g.audio && !g.existingFileId).length > 0 && (
                    <>
                      <Text fontSize="xs" color="yellow.300" fontWeight="semibold" mb={1} mt={2}>No matching audio found (will not upload):</Text>
                      {groups.filter(g => !g.audio && !g.existingFileId).map(g => (
                        <Text key={g.stem} fontSize="xs" color="fg.muted">{g.stem}: upload audio first</Text>
                      ))}
                    </>
                  )}
                </Box>
              )}
            </Box>
          ) : (
            <Box bg="bg.subtle" borderWidth="1px" borderColor="border" rounded="lg" px={5} py={10} textAlign="center">
              <Text color="fg.muted" fontSize="sm">No files in queue — drag files above or click to browse</Text>
            </Box>
          )}
        </Tabs.Content>

        {/* ── FOLDER TAB ───────────────────────────────────────────── */}
        <Tabs.Content value="folder">
          {/* Info box */}
          <Box bg="blue.900" borderWidth="1px" borderColor="blue.700" rounded="md" px={4} py={3} mb={5} fontSize="xs" color="blue.200">
            <Text fontWeight="semibold" mb={1}>Two modes — auto-detected from the folder you select:</Text>
            <Text mb={0.5}>
              <Text as="span" fontWeight="bold" color="blue.300">Dataset mode</Text>
              {" "}— select a root folder that contains subfolders named{" "}
              <Text as="span" fontFamily="mono">audio/</Text>,{" "}
              <Text as="span" fontFamily="mono">emotion_gender/</Text>,{" "}
              <Text as="span" fontFamily="mono">speaker/</Text>,{" "}
              <Text as="span" fontFamily="mono">transcription/</Text>.
              Audio files and their matching JSON files are uploaded together as a new dataset.
            </Text>
            <Text>
              <Text as="span" fontWeight="bold" color="purple.300">Single-type mode</Text>
              {" "}— select a folder named{" "}
              <Text as="span" fontFamily="mono">emotion_gender/</Text>,{" "}
              <Text as="span" fontFamily="mono">speaker/</Text>, or{" "}
              <Text as="span" fontFamily="mono">transcription/</Text> directly.
              JSON files are matched to existing audio by filename and linked automatically.
            </Text>
          </Box>

          {/* Hidden folder input — webkitdirectory must be in JSX so React keeps it in the DOM */}
          {!folderAnalysis ? (
            <Box>
              <input
                id="folder-picker"
                type="file"
                // @ts-ignore
                webkitdirectory=""
                directory=""
                style={{ display: "none" }}
                onChange={e => handleFolderSelect(e.target.files)}
              />
              <Flex
                align="center" gap={4} p={8}
                bg="bg.subtle" rounded="lg" borderWidth="2px" borderStyle="dashed" borderColor="border"
                cursor="pointer" transition="border-color 0.15s"
                _hover={{ borderColor: "blue.500" }}
                onClick={() => document.getElementById("folder-picker")?.click()}
                direction="column"
              >
                <FolderOpen size={32} color="var(--chakra-colors-fg-muted)" />
                <Box textAlign="center">
                  <Text fontSize="sm" fontWeight="semibold" color="fg" mb={1}>Select a folder</Text>
                  <Text fontSize="xs" color="fg.muted">
                    Dataset root folder (with subfolders) or a single-type folder like{" "}
                    <Text as="span" fontFamily="mono">emotion_gender/</Text>
                  </Text>
                </Box>
                <Button size="sm" colorPalette="blue" variant="outline">Browse…</Button>
              </Flex>
            </Box>
          ) : (
            <Box bg="bg.subtle" borderWidth="1px" borderColor="border" rounded="lg" p={5}>
              {/* Header */}
              <Flex justify="space-between" align="center" mb={4}>
                <Flex align="center" gap={3}>
                  <Text fontWeight="semibold" color="fg" fontFamily="mono">{folderAnalysis.rootFolder}/</Text>
                  <Badge colorPalette={folderAnalysis.mode === "dataset" ? "blue" : "purple"} size="sm">
                    {folderAnalysis.mode === "dataset" ? "Dataset mode" : "Single-type mode"}
                  </Badge>
                  {folderAnalysis.mode === "single_type" && folderAnalysis.singleType && (
                    <Badge colorPalette={typeColor(folderAnalysis.singleType)} size="sm">
                      {typeLabel(folderAnalysis.singleType)}
                    </Badge>
                  )}
                </Flex>
                <Button size="xs" variant="ghost" color="fg.muted" disabled={folderUploading}
                  onClick={() => { setFolderAnalysis(null); setSingleResults({}); setFolderProgress({ done: 0, total: 0, current: "" }); }}>
                  <X size={12} /> Change folder
                </Button>
              </Flex>

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

              {/* ── DATASET MODE UI ── */}
              {folderAnalysis.mode === "dataset" && (
                <>
                  {/* Subfolders */}
                  <Text fontSize="xs" color="fg.muted" fontWeight="semibold" textTransform="uppercase" letterSpacing="wide" mb={2}>Detected Subfolders</Text>
                  <Box bg="bg.muted" rounded="md" p={3} mb={4}>
                    {folderAnalysis.subfolders.length === 0 ? (
                      <Text fontSize="sm" color="fg.muted">No recognised subfolders found.</Text>
                    ) : folderAnalysis.subfolders.map(sf => (
                      <Flex key={sf.name} align="center" gap={3} mb={1}>
                        {sf.isKnown
                          ? <CheckCircle size={13} color="var(--chakra-colors-green-400)" />
                          : <AlertCircle size={13} color="var(--chakra-colors-red-400)" />}
                        <Text fontSize="sm" fontFamily="mono" color={sf.isKnown ? "fg" : "fg.muted"} minW="160px">{sf.name}/</Text>
                        <Badge colorPalette={sf.isKnown ? typeColor(sf.type) : "red"} size="sm">
                          {sf.isKnown ? typeLabel(sf.type) : "Skipped"}
                        </Badge>
                        <Text fontSize="xs" color="fg.muted">{sf.count} files</Text>
                      </Flex>
                    ))}
                  </Box>

                  {/* Summary */}
                  <Box bg="bg.muted" rounded="md" p={3} mb={4}>
                    <Text fontSize="sm" color="fg">
                      <Text as="span" fontWeight="bold" color="blue.400">{folderAnalysis.uploadableGroups.length}</Text>
                      {" "}file group{folderAnalysis.uploadableGroups.length !== 1 ? "s" : ""} ready to upload
                      {folderAnalysis.datasetSkippedCount > 0 && (
                        <Text as="span" color="fg.muted"> · {folderAnalysis.datasetSkippedCount} skipped (no audio)</Text>
                      )}
                    </Text>
                  </Box>

                  {/* Settings */}
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
                      <LangInput value={folderLanguage} onChange={setFolderLanguage} disabled={folderUploading} />
                    </Field.Root>
                  </Grid>

                  {/* Progress */}
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
                    colorPalette="blue" size="sm" loading={folderUploading}
                    disabled={folderAnalysis.uploadableGroups.length === 0 || !folderDatasetName.trim() || folderUploading}
                    onClick={uploadFolderDataset}
                  >
                    <Upload size={14} />
                    Upload {folderAnalysis.uploadableGroups.length} Group{folderAnalysis.uploadableGroups.length !== 1 ? "s" : ""}
                  </Button>
                </>
              )}

              {/* ── SINGLE-TYPE MODE UI ── */}
              {folderAnalysis.mode === "single_type" && (
                <>
                  {/* Match table */}
                  <Box bg="bg.muted" rounded="md" p={3} mb={4}>
                    <Text fontSize="sm" color="fg" mb={1}>
                      <Text as="span" fontWeight="bold" color="green.400">{folderAnalysis.matches.length}</Text> matched ·{" "}
                      <Text as="span" color="fg.muted">{folderAnalysis.unmatched.length} unmatched (no audio in system)</Text>
                    </Text>
                  </Box>

                  {folderAnalysis.matches.length > 0 && (
                    <Box bg="bg.subtle" borderWidth="1px" borderColor="border" rounded="md" overflow="hidden" mb={4}>
                      <Table.Root size="sm">
                        <Table.Header>
                          <Table.Row>
                            {["JSON file", "Links to", "Status"].map(h => (
                              <Table.ColumnHeader key={h} color="fg.muted" fontSize="xs" px={4} py={2}>{h}</Table.ColumnHeader>
                            ))}
                          </Table.Row>
                        </Table.Header>
                        <Table.Body>
                          {folderAnalysis.matches.map(m => {
                            const st = singleResults[m.stem];
                            return (
                              <Table.Row key={m.stem} _hover={{ bg: "bg.muted" }}>
                                <Table.Cell px={4} py={2}><Text fontSize="xs" fontFamily="mono" color="fg">{m.file.name}</Text></Table.Cell>
                                <Table.Cell px={4} py={2}><Text fontSize="xs" fontFamily="mono" color="blue.300">{m.existingFilename}</Text></Table.Cell>
                                <Table.Cell px={4} py={2}>
                                  {st ? (
                                    <Flex align="center" gap={1.5}>
                                      {statusIcon(st)}
                                      <Badge colorPalette={st === "done" ? "green" : st === "error" ? "red" : st === "uploading" ? "blue" : "gray"} size="sm">{st}</Badge>
                                    </Flex>
                                  ) : (
                                    <Badge colorPalette="green" size="sm"><Link2 size={10} /> ready</Badge>
                                  )}
                                </Table.Cell>
                              </Table.Row>
                            );
                          })}
                        </Table.Body>
                      </Table.Root>
                    </Box>
                  )}

                  {/* Progress */}
                  {(folderUploading || folderDone) && (
                    <Box mb={4}>
                      <Flex justify="space-between" mb={1}>
                        <Text fontSize="xs" color="fg.muted">
                          {folderUploading ? `Linking: ${folderProgress.current}` : "Done"}
                        </Text>
                        <Text fontSize="xs" color="fg.muted">{folderProgress.done}/{folderProgress.total}</Text>
                      </Flex>
                      <Progress.Root value={folderProgressPct} size="sm" colorPalette={folderDone ? "green" : "purple"}>
                        <Progress.Track rounded="full"><Progress.Range /></Progress.Track>
                      </Progress.Root>
                    </Box>
                  )}

                  <Button
                    colorPalette="purple" size="sm" loading={folderUploading}
                    disabled={folderAnalysis.matches.length === 0 || folderUploading}
                    onClick={uploadSingleTypeFolder}
                  >
                    <Link2 size={14} />
                    Link {folderAnalysis.matches.length} File{folderAnalysis.matches.length !== 1 ? "s" : ""}
                  </Button>
                </>
              )}
            </Box>
          )}
        </Tabs.Content>
      </Tabs.Root>
    </Box>
  );
}
