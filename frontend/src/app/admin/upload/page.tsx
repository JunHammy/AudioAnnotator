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
  Select,
  Table,
  Text,
  Portal,
  createListCollection,
} from "@chakra-ui/react";
import { Upload, X, CheckCircle, AlertCircle, Loader } from "lucide-react";
import api from "@/lib/axios";
import ToastWizard from "@/lib/toastWizard";

// ── Types ──────────────────────────────────────────────────────────────────

type FileType = "audio" | "emotion_gender" | "speaker" | "transcription" | "unknown";
type UploadStatus = "ready" | "uploading" | "done" | "error";

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
  stem: string;             // e.g. my001005_9454
  audio?:          QueueItem;
  emotion_gender?: QueueItem;
  speaker?:        QueueItem;
  transcription?:  QueueItem;
  status: UploadStatus;
  // Set when JSON-only group matches a file already in the DB
  existingFileId?:   number;
  existingFilename?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

const LANGUAGE_OPTIONS = createListCollection({
  items: [
    { label: "English", value: "English" },
    { label: "Malay",   value: "Malay" },
    { label: "Chinese", value: "Chinese" },
    { label: "Tamil",   value: "Tamil" },
  ],
});

function detectFileType(filename: string): { type: FileType; stem: string } {
  const name  = filename.toLowerCase();
  const ext   = name.split(".").pop() ?? "";
  const base  = filename.replace(/\.[^.]+$/, ""); // stem without extension

  if (ext === "wav" || ext === "mp3") {
    return { type: "audio", stem: base };
  }
  if (ext === "json") {
    // Check folder-style naming (data/emotion_gender/name.json) — but we only get the file
    // Fall back to filename suffix patterns
    if (base.endsWith("_emotion") || base.endsWith("_emotion_gender")) {
      return { type: "emotion_gender", stem: base.replace(/_emotion_gender$/, "").replace(/_emotion$/, "") };
    }
    if (base.endsWith("_speaker")) {
      return { type: "speaker", stem: base.replace(/_speaker$/, "") };
    }
    if (base.endsWith("_transcription")) {
      return { type: "transcription", stem: base.replace(/_transcription$/, "") };
    }
    // No suffix — user must have selected from data/<folder>/name.json style
    // Prompt user to tag them; for now mark unknown
    return { type: "unknown", stem: base };
  }
  return { type: "unknown", stem: base };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function typeLabel(t: FileType): string {
  const map: Record<FileType, string> = {
    audio:          "Audio",
    emotion_gender: "Emotion / Gender",
    speaker:        "Speaker",
    transcription:  "Transcription",
    unknown:        "Unknown",
  };
  return map[t];
}

function typeColor(t: FileType): string {
  const map: Record<FileType, string> = {
    audio:          "blue",
    emotion_gender: "purple",
    speaker:        "orange",
    transcription:  "green",
    unknown:        "red",
  };
  return map[t];
}

function statusIcon(s: UploadStatus) {
  if (s === "done")      return <CheckCircle size={14} color="var(--chakra-colors-green-400)" />;
  if (s === "error")     return <AlertCircle size={14} color="var(--chakra-colors-red-400)" />;
  if (s === "uploading") return <Loader     size={14} color="var(--chakra-colors-blue-400)" />;
  return null;
}

function groupItems(items: QueueItem[], existingMap: Map<string, ExistingFile>): FileGroup[] {
  const map = new Map<string, FileGroup>();
  for (const item of items) {
    const { stem } = detectFileType(item.file.name);
    // Respect user's manual type override; only fall back to auto-detection
    const type = item.fileType !== "unknown" ? item.fileType : detectFileType(item.file.name).type;
    if (!map.has(stem)) {
      const existing = existingMap.get(stem);
      map.set(stem, {
        stem,
        status: "ready",
        existingFileId:   existing?.id,
        existingFilename: existing?.filename,
      });
    }
    const g = map.get(stem)!;
    if (type === "audio")          g.audio          = item;
    if (type === "emotion_gender") g.emotion_gender = item;
    if (type === "speaker")        g.speaker        = item;
    if (type === "transcription")  g.transcription  = item;
  }
  return [...map.values()];
}

function groupReady(g: FileGroup): boolean {
  const hasUnuploadedJson = [g.emotion_gender, g.speaker, g.transcription]
    .some(item => item && item.status !== "done");

  // Audio already uploaded — remaining JSONs can be linked
  if (g.audio?.status === "done" && g.existingFileId && hasUnuploadedJson) return true;
  // New audio upload (with optional JSONs)
  if (g.audio && g.audio.status !== "done") return true;
  // JSON-only linking to an existing DB file
  if (!g.audio && g.existingFileId && hasUnuploadedJson) return true;
  return false;
}

// ── Drop Zone ──────────────────────────────────────────────────────────────

function DropZone({ onFiles }: { onFiles: (files: File[]) => void }) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const files = [...e.dataTransfer.files];
    onFiles(files);
  }, [onFiles]);

  return (
    <Box
      borderWidth="2px"
      borderStyle="dashed"
      borderColor={dragging ? "blue.400" : "border"}
      bg={dragging ? "blue.900" : "bg.muted"}
      rounded="lg"
      p={10}
      textAlign="center"
      cursor="pointer"
      transition="all 0.15s"
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".wav,.mp3,.json"
        style={{ display: "none" }}
        onChange={(e) => onFiles([...e.target.files!])}
      />
      <Upload size={32} color="var(--chakra-colors-fg-muted)" style={{ margin: "0 auto 12px" }} />
      <Text color="fg" fontWeight="medium" mb={1}>Drag &amp; drop files here</Text>
      <Text fontSize="sm" color="fg.muted" mb={3}>or click to browse</Text>
      <Text fontSize="xs" color="fg.muted">Audio required (.wav/.mp3). Optional: .json files for emotion_gender, speaker, transcription</Text>
    </Box>
  );
}

// ── JSON Type Selector ─────────────────────────────────────────────────────

const JSON_TYPE_OPTIONS = createListCollection({
  items: [
    { label: "Emotion / Gender", value: "emotion_gender" },
    { label: "Speaker",          value: "speaker" },
    { label: "Transcription",    value: "transcription" },
    { label: "Unknown",          value: "unknown" },
  ],
});

// ── Page ──────────────────────────────────────────────────────────────────

export default function UploadFilesPage() {
  const [queue,          setQueue]          = useState<QueueItem[]>([]);
  const [language,       setLanguage]       = useState<string[]>(["English"]);
  const [uploading,      setUploading]      = useState(false);
  const [existingFiles,  setExistingFiles]  = useState<ExistingFile[]>([]);

  // Fetch existing DB files so we can auto-match JSON-only uploads
  useEffect(() => {
    api.get("/api/audio-files")
      .then(r => setExistingFiles(r.data))
      .catch(() => {}); // non-critical — matching just won't work if this fails
  }, []);

  // Stem → existing DB file map (strip extension from filename)
  const existingMap = new Map<string, ExistingFile>();
  for (const f of existingFiles) {
    const stem = f.filename.replace(/\.[^.]+$/, "");
    existingMap.set(stem, f);
  }


  function addFiles(files: File[]) {
    const newItems: QueueItem[] = files
      .filter((f) => {
        const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
        return ["wav", "mp3", "json"].includes(ext);
      })
      .map((f) => ({
        id:       crypto.randomUUID(),
        file:     f,
        fileType: detectFileType(f.name).type,
        status:   "ready" as UploadStatus,
      }));
    // Deduplicate audio files by name, but allow multiple JSON files with the same name
    // (user's data may have same-named JSONs in different type folders)
    setQueue((prev) => {
      const existingAudioNames = new Set(
        prev.filter((i) => i.fileType === "audio").map((i) => i.file.name)
      );
      return [
        ...prev,
        ...newItems.filter((i) => i.fileType !== "audio" || !existingAudioNames.has(i.file.name)),
      ];
    });
  }

  function removeItem(id: string) {
    setQueue((prev) => prev.filter((i) => i.id !== id));
  }

  function updateItemType(id: string, type: FileType) {
    setQueue((prev) => prev.map((i) => i.id === id ? { ...i, fileType: type } : i));
  }

  const groups = groupItems(queue, existingMap);

  const updateItemStatus = (ids: string[], status: UploadStatus, error?: string) => {
    setQueue((prev) => prev.map((i) => ids.includes(i.id) ? { ...i, status, error } : i));
  };

  async function uploadGroup(g: FileGroup) {
    if (!groupReady(g)) return;

    // If audio was already uploaded this session, treat remaining JSONs as a link operation
    const audioAlreadyDone = g.audio?.status === "done";

    // ── JSON-only: link to an existing DB file ──────────────────────────────
    if ((!g.audio || audioAlreadyDone) && g.existingFileId) {
      const jsonSlots = [
        { item: g.emotion_gender, type: "emotion_gender" },
        { item: g.speaker,        type: "speaker" },
        { item: g.transcription,  type: "transcription" },
      ].filter(({ item }) => !!item && item.status !== "done") as { item: QueueItem; type: string }[];

      for (const { item, type } of jsonSlots) {
        updateItemStatus([item.id], "uploading");
        const fd = new FormData();
        fd.append("json_file", item.file);
        fd.append("json_type", type);
        try {
          await api.post(`/api/audio-files/${g.existingFileId}/json`, fd, {
            headers: { "Content-Type": "multipart/form-data" },
          });
          updateItemStatus([item.id], "done");
          // Refresh the existing file's json_types so the map stays current
          setExistingFiles(prev => prev.map(f =>
            f.id === g.existingFileId
              ? { ...f, json_types: [...new Set([...f.json_types, type])] }
              : f
          ));
        } catch (e: any) {
          const msg = e?.response?.data?.detail ?? "Link failed.";
          updateItemStatus([item.id], "error", msg);
          ToastWizard.standard("error", "Link failed", `${item.file.name}: ${msg}`, 5000, true);
        }
      }
      ToastWizard.standard("success", "Linked", `JSON(s) linked to ${g.existingFilename ?? g.stem}.`, 3000, true);
      return;
    }

    // ── Normal: new audio upload ────────────────────────────────────────────
    if (!g.audio) return;

    const ids = [g.audio, g.emotion_gender, g.speaker, g.transcription]
      .filter(Boolean).map((i) => i!.id);
    updateItemStatus(ids, "uploading");

    const fd = new FormData();
    fd.append("audio", g.audio.file);
    if (g.emotion_gender) fd.append("emotion_gender_json", g.emotion_gender.file);
    if (g.speaker)        fd.append("speaker_json",        g.speaker.file);
    if (g.transcription)  fd.append("transcription_json",  g.transcription.file);
    fd.append("language",  language[0] ?? "");

    try {
      const res = await api.post("/api/audio-files", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      updateItemStatus(ids, "done");
      // Add newly uploaded file to existing map so follow-up JSON uploads can link to it
      const newFile: ExistingFile = res.data;
      setExistingFiles(prev => [newFile, ...prev]);
      ToastWizard.standard("success", "Uploaded", `${g.stem} uploaded successfully.`, 3000, true);
    } catch (e: any) {
      const msg = e?.response?.data?.detail ?? "Upload failed.";
      updateItemStatus(ids, "error", msg);
      ToastWizard.standard("error", "Upload failed", `${g.stem}: ${msg}`, 5000, true);
    }
  }

  async function uploadAll() {
    const ready = groups.filter(groupReady);
    if (!ready.length) return;

    setUploading(true);
    await Promise.all(ready.map(uploadGroup));
    setUploading(false);
  }

  function clearDone() {
    setQueue((prev) => prev.filter((i) => i.status !== "done"));
  }

  const readyCount  = groups.filter(groupReady).length;
  const linkCount   = groups.filter(g => !g.audio && g.existingFileId && groupReady(g)).length;
  const doneCount   = groups.filter(g => {
    const all = [g.audio, g.emotion_gender, g.speaker, g.transcription].filter(Boolean) as QueueItem[];
    return all.length > 0 && all.every(i => i.status === "done");
  }).length;
  const errorCount  = groups.filter(g => {
    const all = [g.audio, g.emotion_gender, g.speaker, g.transcription].filter(Boolean) as QueueItem[];
    return all.some(i => i.status === "error");
  }).length;

  return (
    <Box p={8} maxW="1100px">
      <Heading size="lg" color="fg" mb={1}>Upload Files</Heading>
      <Text color="fg.muted" mb={6}>Upload audio files — JSON annotation files are optional. Providing them seeds pre-annotated segments.</Text>

      <Grid templateColumns="1fr 280px" gap={6} mb={6}>
        {/* Drop zone */}
        <DropZone onFiles={addFiles} />

        {/* Upload settings */}
        <Box bg="bg.subtle" borderWidth="1px" borderColor="border" rounded="lg" p={5}>
          <Text fontSize="sm" fontWeight="semibold" color="fg" mb={4}>Upload Settings</Text>

          <Field.Root mb={4}>
            <Field.Label color="fg" fontSize="sm">Language</Field.Label>
            <Select.Root collection={LANGUAGE_OPTIONS} value={language} onValueChange={(d) => setLanguage(d.value)} size="sm">
              <Select.HiddenSelect />
              <Select.Control>
                <Select.Trigger bg="bg.muted" borderColor="border" color="fg">
                  <Select.ValueText />
                </Select.Trigger>
              </Select.Control>
              <Portal>
                <Select.Positioner>
                  <Select.Content bg="bg.subtle" borderColor="border">
                    {LANGUAGE_OPTIONS.items.map((item) => (
                      <Select.Item key={item.value} item={item} color="fg" _hover={{ bg: "bg.muted" }}>
                        {item.label}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Positioner>
              </Portal>
            </Select.Root>
          </Field.Root>


          {/* Summary */}
          <Box bg="bg.muted" rounded="md" p={3} mb={4} fontSize="xs" color="fg.muted">
            <Text mb={1}><Text as="span" color="fg">{readyCount - linkCount}</Text> new uploads</Text>
            {linkCount > 0 && <Text mb={1}><Text as="span" color="blue.400">{linkCount}</Text> JSON links to existing</Text>}
            {doneCount > 0 && <Text mb={1}><Text as="span" color="green.400">{doneCount}</Text> done</Text>}
            {errorCount > 0 && <Text><Text as="span" color="red.400">{errorCount}</Text> failed</Text>}
          </Box>

          <Flex direction="column" gap={2}>
            <Button
              colorPalette="blue"
              size="sm"
              w="full"
              loading={uploading}
              disabled={readyCount === 0}
              onClick={uploadAll}
            >
              <Upload size={14} />
              Upload All ({readyCount})
            </Button>
            {queue.length > 0 && (
              <Button variant="outline" size="sm" w="full" onClick={() => setQueue([])}>
                Clear Queue
              </Button>
            )}
            {doneCount > 0 && (
              <Button variant="ghost" size="sm" w="full" color="fg.muted" onClick={clearDone}>
                Clear Completed
              </Button>
            )}
          </Flex>
        </Box>
      </Grid>

      {/* Preprocessing notice */}
      <Box
        bg="yellow.900"
        borderWidth="1px"
        borderColor="yellow.700"
        rounded="md"
        px={4}
        py={3}
        mb={5}
        fontSize="xs"
        color="yellow.200"
      >
        <Text fontWeight="semibold" mb={1}>What happens on upload:</Text>
        <Text>• Audio-only upload is valid — annotators create segments manually</Text>
        <Text>• speaker_0 → speaker_1 (labels shifted +1 for 1-based numbering) when speaker JSON provided</Text>
        <Text>• Segments seeded from JSON if provided; original JSONs stored as immutable reference</Text>
      </Box>

      {/* Queue table */}
      {queue.length > 0 && (
        <Box bg="bg.subtle" borderWidth="1px" borderColor="border" rounded="lg" overflow="hidden">
          <Box px={5} py={3} borderBottomWidth="1px" borderColor="border">
            <Text fontSize="sm" fontWeight="semibold" color="fg">Upload Queue — {queue.length} files</Text>
          </Box>
          <Table.Root size="sm">
            <Table.Header>
              <Table.Row>
                {["Filename", "Type", "Size", "Status", ""].map((h) => (
                  <Table.ColumnHeader key={h} color="fg.muted" fontSize="xs" px={4} py={3}>{h}</Table.ColumnHeader>
                ))}
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {queue.map((item) => {
                const isJson = item.file.name.toLowerCase().endsWith(".json");
                return (
                  <Table.Row key={item.id} _hover={{ bg: "bg.muted" }}>
                    <Table.Cell px={4} py={2}>
                      <Text fontSize="sm" color="fg" fontFamily="mono">{item.file.name}</Text>
                      {item.error && <Text fontSize="xs" color="red.400" mt={0.5}>{item.error}</Text>}
                    </Table.Cell>
                    <Table.Cell px={4} py={2}>
                      {isJson ? (
                        <Select.Root
                          collection={JSON_TYPE_OPTIONS}
                          value={[item.fileType]}
                          onValueChange={(d) => updateItemType(item.id, d.value[0] as FileType)}
                          size="xs"
                        >
                          <Select.HiddenSelect />
                          <Select.Control>
                            <Select.Trigger
                              bg="bg.muted"
                              borderColor={item.fileType === "unknown" ? "red.500" : "border"}
                              color={item.fileType === "unknown" ? "red.400" : "fg"}
                              minW="140px"
                            >
                              <Select.ValueText placeholder="Tag type…" />
                            </Select.Trigger>
                          </Select.Control>
                          <Portal>
                            <Select.Positioner>
                              <Select.Content bg="bg.subtle" borderColor="border">
                                {JSON_TYPE_OPTIONS.items.map((opt) => (
                                  <Select.Item key={opt.value} item={opt} color="fg" _hover={{ bg: "bg.muted" }}>
                                    {opt.label}
                                  </Select.Item>
                                ))}
                              </Select.Content>
                            </Select.Positioner>
                          </Portal>
                        </Select.Root>
                      ) : (
                        <Badge colorPalette={typeColor(item.fileType)} size="sm">
                          {typeLabel(item.fileType)}
                        </Badge>
                      )}
                    </Table.Cell>
                    <Table.Cell px={4} py={2}>
                      <Text fontSize="xs" color="fg.muted">{formatBytes(item.file.size)}</Text>
                    </Table.Cell>
                    <Table.Cell px={4} py={2}>
                      <Flex align="center" gap={1.5}>
                        {statusIcon(item.status)}
                        <Badge
                          colorPalette={
                            item.status === "done"      ? "green"
                            : item.status === "error"   ? "red"
                            : item.status === "uploading" ? "blue"
                            : "gray"
                          }
                          size="sm"
                        >
                          {item.status}
                        </Badge>
                      </Flex>
                    </Table.Cell>
                    <Table.Cell px={4} py={2}>
                      {item.status !== "uploading" && (
                        <Button
                          size="xs"
                          variant="ghost"
                          color={item.status === "done" ? "fg.subtle" : "fg.muted"}
                          p={0}
                          minW="auto"
                          onClick={() => removeItem(item.id)}
                          title="Remove from queue"
                        >
                          <X size={14} />
                        </Button>
                      )}
                    </Table.Cell>
                  </Table.Row>
                );
              })}
            </Table.Body>
          </Table.Root>

          {/* Auto-match info and unmatched warnings */}
          {groups.some(g => !g.audio) && (
            <Box px={5} py={3} borderTopWidth="1px" borderColor="border">
              {/* Matched — will link to existing */}
              {groups.filter(g => !g.audio && g.existingFileId).map(g => (
                <Text key={g.stem} fontSize="xs" color="blue.300" mb={0.5}>
                  ↗ {g.stem}: will link to existing file <Text as="span" fontFamily="mono">{g.existingFilename}</Text>
                  {g.existingFileId && existingFiles.find(f => f.id === g.existingFileId)?.json_types?.length ? (
                    <Text as="span" color="fg.muted"> (already has: {existingFiles.find(f => f.id === g.existingFileId)?.json_types.join(", ")})</Text>
                  ) : null}
                </Text>
              ))}
              {/* Unmatched — no audio in queue, no DB match */}
              {groups.filter(g => !g.audio && !g.existingFileId).length > 0 && (
                <>
                  <Text fontSize="xs" color="yellow.300" fontWeight="semibold" mb={1} mt={groups.some(g => !g.audio && g.existingFileId) ? 2 : 0}>
                    No matching audio found (will not upload):
                  </Text>
                  {groups.filter(g => !g.audio && !g.existingFileId).map(g => (
                    <Text key={g.stem} fontSize="xs" color="fg.muted">
                      {g.stem}: add the .wav/.mp3 to the queue, or upload audio first
                    </Text>
                  ))}
                </>
              )}
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}
