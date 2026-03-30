"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Badge,
  Box,
  Button,
  Checkbox,
  Dialog,
  Flex,
  Heading,
  HStack,
  IconButton,
  Input,
  Progress,
  Select,
  Table,
  Text,
  Portal,
  createListCollection,
} from "@chakra-ui/react";
import { AlertTriangle, Archive, Calendar, ClipboardCheck, Pause, Play, Plus, RotateCcw, Trash2, Users, Zap } from "lucide-react";
import api from "@/lib/axios";
import ToastWizard from "@/lib/toastWizard";

// ── Types ──────────────────────────────────────────────────────────────────

interface AudioFile {
  id: number;
  filename: string;
  language: string | null;
  num_speakers: number | null;
  duration: number | null;
  collaborative_locked_speaker: boolean;
  collaborative_locked_gender: boolean;
  collaborative_locked_transcription: boolean;
  is_deleted: boolean;
}

interface User {
  id: number;
  username: string;
  role: string;
  is_active: boolean;
}

interface Assignment {
  id: number;
  audio_file_id: number;
  annotator_id: number;
  task_type: string;
  status: string;
  priority: string;
  due_date: string | null;
}

const TASK_TYPES = ["emotion", "gender", "speaker", "transcription"] as const;
type TaskType = typeof TASK_TYPES[number];

// ── Valid task combinations (from supervisor spec) ─────────────────────────

const VALID_COMBOS = [
  { label: "Speaker only",                       tasks: ["speaker"] },
  { label: "Speaker + Gender",                   tasks: ["speaker", "gender"] },
  { label: "Speaker + Transcription",            tasks: ["speaker", "transcription"] },
  { label: "Speaker + Gender + Transcription",   tasks: ["speaker", "gender", "transcription"] },
  { label: "Emotion only",                       tasks: ["emotion"] },
  { label: "Gender only",                        tasks: ["gender"] },
  { label: "Gender + Transcription",             tasks: ["gender", "transcription"] },
  { label: "Transcription only",                 tasks: ["transcription"] },
] as const;

const comboCollection = createListCollection({
  items: VALID_COMBOS.map(c => ({ label: c.label, value: c.label })),
});

// ── Helpers ────────────────────────────────────────────────────────────────

function statusBadge(status: string) {
  const map: Record<string, string> = { completed: "green", in_progress: "orange", pending: "gray" };
  return <Badge colorPalette={map[status] ?? "gray"} size="sm">{status.replace("_", " ")}</Badge>;
}

function priorityBadge(priority: string) {
  const map: Record<string, string> = { high: "red", normal: "blue", low: "gray" };
  return <Badge colorPalette={map[priority] ?? "gray"} size="sm" variant="subtle">{priority}</Badge>;
}

const PRIORITY_OPTIONS = ["low", "normal", "high"] as const;

const priorityCollection = createListCollection({
  items: PRIORITY_OPTIONS.map(p => ({ label: p.charAt(0).toUpperCase() + p.slice(1), value: p })),
});

function groupByAnnotator(assignments: Assignment[]): Map<number, Record<TaskType, Assignment | null>> {
  const map = new Map<number, Record<TaskType, Assignment | null>>();
  for (const a of assignments) {
    if (!map.has(a.annotator_id)) {
      map.set(a.annotator_id, { emotion: null, gender: null, speaker: null, transcription: null });
    }
    (map.get(a.annotator_id)!)[a.task_type as TaskType] = a;
  }
  return map;
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function AssignTasksPage() {
  const router = useRouter();
  const [audioFiles,   setAudioFiles]   = useState<AudioFile[]>([]);
  const [users,        setUsers]        = useState<User[]>([]);
  const [selectedFile, setSelectedFile] = useState<AudioFile | null>(null);
  const [assignments,  setAssignments]  = useState<Assignment[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [saving,       setSaving]       = useState(false);
  const [reopening,    setReopening]    = useState<Set<number>>(new Set());
  const [assigningEmotionAll, setAssigningEmotionAll] = useState(false);

  // New assignment form state
  const [newAnnotatorId, setNewAnnotatorId] = useState<string[]>([]);
  const [newComboLabel,  setNewComboLabel]  = useState<string[]>([]);
  const [newPriority,    setNewPriority]    = useState<string[]>(["normal"]);
  const [newDueDate,     setNewDueDate]     = useState<string>("");

  // Meta edit state (priority/due_date for existing annotator row)
  const [editMetaKey,    setEditMetaKey]    = useState<number | null>(null); // annotatorId
  const [editPriority,   setEditPriority]   = useState<string[]>([]);
  const [editDueDate,    setEditDueDate]    = useState<string>("");
  const [savingMeta,     setSavingMeta]     = useState(false);

  // Audio preview state
  const [playingFileId,  setPlayingFileId]  = useState<number | null>(null);
  const audioRef   = useRef<HTMLAudioElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  // Archive state
  const [archiving,      setArchiving]      = useState<Set<number>>(new Set());
  const [showArchived,   setShowArchived]   = useState(false);

  // File list search
  const [fileSearch,     setFileSearch]     = useState("");

  // Bulk assignment modal state
  const [bulkOpen,          setBulkOpen]          = useState(false);
  const [bulkSearch,        setBulkSearch]        = useState("");
  const [bulkSelected,        setBulkSelected]        = useState<Set<number>>(new Set());
  const [bulkAnnotatorIds,    setBulkAnnotatorIds]    = useState<Set<number>>(new Set());
  const [bulkAnnotatorSearch, setBulkAnnotatorSearch] = useState("");
  const [bulkComboLabel,      setBulkComboLabel]      = useState<string[]>([]);
  const [bulkSaving,          setBulkSaving]          = useState(false);
  const [bulkProgress,        setBulkProgress]        = useState<{ done: number; total: number; errors: string[] } | null>(null);
  const bulkAbort = useRef(false);

  useEffect(() => {
    Promise.all([
      api.get(`/api/audio-files/?include_deleted=${showArchived}`),
      api.get("/api/users/"),
    ])
      .then(([af, u]) => {
        setAudioFiles(af.data);
        setUsers(u.data);
        if (af.data.length > 0) setSelectedFile(af.data[0]);
      })
      .finally(() => setLoading(false));
  }, [showArchived]);

  useEffect(() => {
    if (!selectedFile) return;
    api.get(`/api/assignments/?audio_file_id=${selectedFile.id}`)
      .then((r) => setAssignments(r.data));
  }, [selectedFile]);

  const annotators = users.filter((u) => u.role === "annotator" && u.is_active);
  const groupedAssignments = groupByAnnotator(assignments);

  const annotatorOptions = createListCollection({
    items: annotators.map((u) => ({ label: u.username, value: String(u.id) })),
  });

  // ── Bulk assignment derived values ──────────────────────────────────────────
  const bulkCombo = VALID_COMBOS.find(c => c.label === bulkComboLabel[0]);
  const bulkTasks = bulkCombo ? [...bulkCombo.tasks] : [];

  const filteredAnnotators = useMemo(() => {
    const q = bulkAnnotatorSearch.trim().toLowerCase();
    return q ? annotators.filter(a => a.username.toLowerCase().includes(q)) : annotators;
  }, [annotators, bulkAnnotatorSearch]);

  const filteredFiles = useMemo(() => {
    const q = bulkSearch.trim().toLowerCase();
    return q ? audioFiles.filter(f => f.filename.toLowerCase().includes(q)) : audioFiles;
  }, [audioFiles, bulkSearch]);

  function resetBulk() {
    setBulkSearch("");
    setBulkSelected(new Set());
    setBulkAnnotatorIds(new Set());
    setBulkAnnotatorSearch("");
    setBulkComboLabel([]);
    setBulkProgress(null);
    bulkAbort.current = false;
  }

  async function runBulkAssign() {
    if (bulkAnnotatorIds.size === 0 || bulkTasks.length === 0 || bulkSelected.size === 0) return;
    const annotatorIds = [...bulkAnnotatorIds];
    const fileIds = [...bulkSelected];
    const total = fileIds.length * annotatorIds.length;
    setBulkSaving(true);
    bulkAbort.current = false;
    setBulkProgress({ done: 0, total, errors: [] });

    const errors: string[] = [];
    let done = 0;
    outer: for (const fileId of fileIds) {
      for (const annotatorId of annotatorIds) {
        if (bulkAbort.current) break outer;
        try {
          await api.post("/api/assignments/batch", {
            audio_file_id: fileId,
            annotator_id: annotatorId,
            task_types: bulkTasks,
          });
        } catch (err: unknown) {
          const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
          const fname = audioFiles.find(f => f.id === fileId)?.filename ?? `file_${fileId}`;
          const aname = annotators.find(a => a.id === annotatorId)?.username ?? `user_${annotatorId}`;
          errors.push(`${aname} / ${fname}: ${detail ?? "failed"}`);
        }
        done++;
        setBulkProgress({ done, total, errors: [...errors] });
      }
    }

    setBulkSaving(false);
    if (selectedFile && bulkSelected.has(selectedFile.id)) {
      const fresh = await api.get(`/api/assignments/?audio_file_id=${selectedFile.id}`);
      setAssignments(fresh.data);
    }
    const succeeded = done - errors.length;
    ToastWizard.standard(
      errors.length === 0 ? "success" : "warning",
      `Bulk assign complete`,
      `${succeeded} succeeded, ${errors.length} skipped/failed.`,
      4000, true,
    );
  }

  // Derive selected combo's task list
  const selectedCombo = VALID_COMBOS.find(c => c.label === newComboLabel[0]);
  const selectedTasks = selectedCombo ? [...selectedCombo.tasks] : [];
  const emotionSelected = selectedTasks.includes("emotion");
  const emotionBlocked = emotionSelected && !selectedFile?.collaborative_locked_speaker;

  async function addAnnotator() {
    if (!selectedFile || !newAnnotatorId[0] || selectedTasks.length === 0 || emotionBlocked) return;
    setSaving(true);
    try {
      const res = await api.post("/api/assignments/batch", {
        audio_file_id: selectedFile.id,
        annotator_id: parseInt(newAnnotatorId[0]),
        task_types: selectedTasks,
        priority: newPriority[0] ?? "normal",
        due_date: newDueDate || null,
      });
      // Fetch fresh assignments to reflect any skipped duplicates
      const fresh = await api.get(`/api/assignments/?audio_file_id=${selectedFile.id}`);
      setAssignments(fresh.data);
      ToastWizard.standard("success", "Annotator assigned", `${res.data.length} new task(s) assigned.`, 3000, true);
      setNewAnnotatorId([]);
      setNewComboLabel([]);
      setNewPriority(["normal"]);
      setNewDueDate("");
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      ToastWizard.standard("error", "Assignment failed", msg ?? "Could not create assignment.", 3000, true);
    } finally {
      setSaving(false);
    }
  }

  async function removeAssignment(id: number) {
    try {
      await api.delete(`/api/assignments/${id}`);
      setAssignments((prev) => prev.filter((a) => a.id !== id));
      ToastWizard.standard("success", "Assignment removed", "Assignment deleted.", 2000, true);
    } catch {
      ToastWizard.standard("error", "Delete failed", "Could not remove assignment.", 3000, true);
    }
  }

  async function assignEmotionToAll() {
    if (!selectedFile || !selectedFile.collaborative_locked_speaker) return;
    const annotatorIds = [...groupedAssignments.keys()];
    if (annotatorIds.length === 0) return;
    setAssigningEmotionAll(true);
    let succeeded = 0;
    const errors: string[] = [];
    for (const annotatorId of annotatorIds) {
      try {
        await api.post("/api/assignments/batch", {
          audio_file_id: selectedFile.id,
          annotator_id: annotatorId,
          task_types: ["emotion"],
        });
        succeeded++;
      } catch (err: unknown) {
        const username = users.find(u => u.id === annotatorId)?.username ?? `user_${annotatorId}`;
        const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
        errors.push(`${username}: ${detail ?? "failed"}`);
      }
    }
    const fresh = await api.get(`/api/assignments/?audio_file_id=${selectedFile.id}`);
    setAssignments(fresh.data);
    setAssigningEmotionAll(false);
    ToastWizard.standard(
      errors.length === 0 ? "success" : "warning",
      "Emotion assigned",
      `${succeeded} annotator(s) assigned${errors.length > 0 ? `, ${errors.length} skipped/failed` : ""}.`,
      3000, true,
    );
  }

  async function reopenAssignment(id: number) {
    setReopening(prev => new Set(prev).add(id));
    try {
      await api.patch(`/api/assignments/${id}/status`, { status: "in_progress" });
      setAssignments(prev => prev.map(a => a.id === id ? { ...a, status: "in_progress" } : a));
      ToastWizard.standard("success", "Task reopened", "Status set to In Progress.", 2000, true);
    } catch {
      ToastWizard.standard("error", "Reopen failed", "Could not reopen the task.", 3000, true);
    } finally {
      setReopening(prev => { const s = new Set(prev); s.delete(id); return s; });
    }
  }

  async function togglePreview(fileId: number) {
    // Stop any currently playing audio
    audioRef.current?.pause();
    audioRef.current = null;
    if (blobUrlRef.current) { URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = null; }

    if (playingFileId === fileId) {
      setPlayingFileId(null);
      return;
    }
    setPlayingFileId(fileId);
    try {
      // Fetch via axios so the JWT interceptor attaches Authorization header
      const res = await api.get(`/api/audio-files/${fileId}/stream`, { responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      blobUrlRef.current = url;
      const a = new Audio(url);
      a.onended = () => { setPlayingFileId(null); URL.revokeObjectURL(url); blobUrlRef.current = null; };
      a.onerror = () => { setPlayingFileId(null); };
      a.play().catch(() => setPlayingFileId(null));
      audioRef.current = a;
    } catch {
      setPlayingFileId(null);
      ToastWizard.standard("error", "Preview failed", "Could not load audio.", 3000, true);
    }
  }

  async function archiveFile(fileId: number) {
    setArchiving(prev => new Set(prev).add(fileId));
    try {
      await api.delete(`/api/audio-files/${fileId}`);
      setAudioFiles(prev => prev.filter(f => f.id !== fileId));
      if (selectedFile?.id === fileId) setSelectedFile(null);
      ToastWizard.standard("success", "File archived", "File hidden from all lists.", 3000, true);
    } catch {
      ToastWizard.standard("error", "Archive failed", "Could not archive file.", 3000, true);
    } finally {
      setArchiving(prev => { const s = new Set(prev); s.delete(fileId); return s; });
    }
  }

  async function restoreFile(fileId: number) {
    setArchiving(prev => new Set(prev).add(fileId));
    try {
      const res = await api.patch(`/api/audio-files/${fileId}/restore`);
      setAudioFiles(prev => prev.map(f => f.id === fileId ? { ...f, is_deleted: false } : f));
      ToastWizard.standard("success", "File restored", res.data.filename, 3000, true);
    } catch {
      ToastWizard.standard("error", "Restore failed", "Could not restore file.", 3000, true);
    } finally {
      setArchiving(prev => { const s = new Set(prev); s.delete(fileId); return s; });
    }
  }

  async function saveMetaForAnnotator(annotatorId: number) {
    if (!editPriority[0]) return;
    const rows = assignments.filter(a => a.annotator_id === annotatorId);
    setSavingMeta(true);
    try {
      await Promise.all(rows.map(a =>
        api.patch(`/api/assignments/${a.id}/meta`, {
          priority: editPriority[0],
          due_date: editDueDate || null,
        })
      ));
      setAssignments(prev => prev.map(a =>
        a.annotator_id === annotatorId
          ? { ...a, priority: editPriority[0], due_date: editDueDate || null }
          : a
      ));
      setEditMetaKey(null);
      ToastWizard.standard("success", "Updated", "Priority and due date saved.", 2000, true);
    } catch {
      ToastWizard.standard("error", "Save failed", "Could not update priority.", 3000, true);
    } finally {
      setSavingMeta(false);
    }
  }

  // Coverage summary per task type
  const emotionAnnotators = assignments
    .filter((a) => a.task_type === "emotion")
    .map((a) => users.find((u) => u.id === a.annotator_id)?.username)
    .filter(Boolean);


  return (
    <Box p={8} h="full">
      <HStack mb={1} justify="space-between" align="flex-start">
        <Heading size="lg" color="fg">Assign Tasks</Heading>
        <HStack gap={2}>
          <Button
            size="sm"
            variant={showArchived ? "solid" : "outline"}
            colorPalette={showArchived ? "orange" : "gray"}
            onClick={() => setShowArchived(v => !v)}
          >
            <Archive size={14} />
            {showArchived ? "Hide Archived" : "Show Archived"}
          </Button>
          <Button size="sm" colorPalette="teal" variant="outline" onClick={() => { resetBulk(); setBulkOpen(true); }}>
            <Users size={14} />
            Bulk Assign
          </Button>
        </HStack>
      </HStack>
      <Text color="fg.muted" mb={6}>Select a file to manage its annotator assignments</Text>

      {loading ? (
        <Text color="fg.muted">Loading…</Text>
      ) : (
        <Flex gap={5} h="calc(100vh - 180px)" align="start">
          {/* ── Left: file list ─────────────────────────────────── */}
          <Box
            w="340px"
            flexShrink={0}
            bg="bg.subtle"
            borderWidth="1px"
            borderColor="border"
            rounded="lg"
            overflow="hidden"
            h="full"
          >
            <Box px={4} py={3} borderBottomWidth="1px" borderColor="border">
              <Text fontSize="sm" fontWeight="semibold" color="fg" mb={2}>Audio Files ({audioFiles.length})</Text>
              <Input
                size="xs"
                placeholder="Search files…"
                value={fileSearch}
                onChange={e => setFileSearch(e.target.value)}
                bg="bg.muted"
                borderColor="border"
                color="fg"
              />
            </Box>
            <Box
              overflow="auto"
              h="calc(100% - 80px)"
              css={{
                "&::-webkit-scrollbar": { width: "5px" },
                "&::-webkit-scrollbar-track": { background: "transparent" },
                "&::-webkit-scrollbar-thumb": { background: "#4a4c54", borderRadius: "999px" },
                "&::-webkit-scrollbar-thumb:hover": { background: "#5c5f6b" },
              }}
            >
              {audioFiles.filter(af => !fileSearch || af.filename.toLowerCase().includes(fileSearch.toLowerCase())).map((af) => {
                const isSelected = selectedFile?.id === af.id;
                return (
                  <Box
                    key={af.id}
                    px={4}
                    py={3}
                    cursor="pointer"
                    bg={isSelected ? "bg.muted" : "transparent"}
                    borderLeftWidth="3px"
                    borderLeftColor={isSelected ? (af.is_deleted ? "orange.400" : "blue.400") : "transparent"}
                    _hover={{ bg: "bg.muted" }}
                    onClick={() => setSelectedFile(af)}
                    borderBottomWidth="1px"
                    borderBottomColor="border"
                    opacity={af.is_deleted ? 0.55 : 1}
                  >
                    <Flex justify="space-between" align="flex-start" mb={0.5}>
                      <Text fontSize="sm" color="fg" fontFamily="mono" flex={1} mr={1}>
                        {af.filename.replace(/\.[^.]+$/, "")}
                      </Text>
                      <HStack gap={0.5} flexShrink={0} onClick={e => e.stopPropagation()}>
                        {!af.is_deleted && (
                          <IconButton
                            aria-label="Preview audio"
                            size="2xs"
                            variant="ghost"
                            color={playingFileId === af.id ? "blue.400" : "fg.muted"}
                            onClick={() => togglePreview(af.id)}
                            title="Preview audio"
                          >
                            {playingFileId === af.id ? <Pause size={11} /> : <Play size={11} />}
                          </IconButton>
                        )}
                        {af.is_deleted ? (
                          <IconButton
                            aria-label="Restore file"
                            size="2xs"
                            variant="ghost"
                            color="orange.400"
                            loading={archiving.has(af.id)}
                            onClick={() => restoreFile(af.id)}
                            title="Restore file"
                          >
                            <RotateCcw size={11} />
                          </IconButton>
                        ) : (
                          <IconButton
                            aria-label="Archive file"
                            size="2xs"
                            variant="ghost"
                            color="fg.muted"
                            loading={archiving.has(af.id)}
                            onClick={() => archiveFile(af.id)}
                            title="Archive file (soft delete)"
                          >
                            <Archive size={11} />
                          </IconButton>
                        )}
                      </HStack>
                    </Flex>
                    <Flex gap={3} align="center">
                      <Text fontSize="xs" color="fg.muted">{af.language ?? "—"}</Text>
                      <Text fontSize="xs" color="fg.muted">{af.num_speakers ?? "?"} spk</Text>
                      <Text fontSize="xs" color="fg.muted" fontFamily="mono">
                        {af.duration ? `${af.duration.toFixed(0)}s` : ""}
                      </Text>
                      {af.is_deleted && <Badge colorPalette="orange" size="sm" variant="subtle">archived</Badge>}
                    </Flex>
                  </Box>
                );
              })}
            </Box>
          </Box>

          {/* ── Right: assignment panel ──────────────────────────── */}
          {selectedFile ? (
            <Box flex={1} bg="bg.subtle" borderWidth="1px" borderColor="border" rounded="lg" overflow="hidden" h="full">
              {/* File info bar + lock toggles */}
              <Box px={5} py={3} borderBottomWidth="1px" borderColor="border">
                <Flex gap={4} align="center" wrap="wrap">
                  <Text fontSize="sm" fontWeight="semibold" color="fg" fontFamily="mono">
                    {selectedFile.filename.replace(/\.[^.]+$/, "")}
                  </Text>
                  <Badge colorPalette="blue" size="sm">{selectedFile.language ?? "—"}</Badge>
                  <Text fontSize="xs" color="fg.muted">{selectedFile.duration?.toFixed(1)}s</Text>
                  <Text fontSize="xs" color="fg.muted">{selectedFile.num_speakers} speakers</Text>
                  <Button
                    ml="auto"
                    size="xs"
                    variant="outline"
                    colorPalette="blue"
                    onClick={() => router.push(`/admin/review?file=${selectedFile.id}`)}
                    title="Open in Review & Finalize to lock/unlock tasks"
                  >
                    <ClipboardCheck size={12} /> Review & Finalize
                  </Button>
                </Flex>
              </Box>

              <Box overflow="auto" h="calc(100% - 50px)" px={5} py={4}>
                {/* Assignment table */}
                <Text fontSize="sm" fontWeight="semibold" color="fg" mb={3}>
                  Assigned Annotators — {groupedAssignments.size} assigned
                </Text>

                {groupedAssignments.size > 0 && (
                  <Box borderWidth="1px" borderColor="border" rounded="md" overflow="hidden" mb={5}>
                    <Table.Root size="sm">
                      <Table.Header>
                        <Table.Row>
                          <Table.ColumnHeader color="fg.muted" fontSize="xs" px={4} py={2}>Annotator</Table.ColumnHeader>
                          {TASK_TYPES.map((t) => (
                            <Table.ColumnHeader key={t} color="fg.muted" fontSize="xs" px={3} py={2} textTransform="capitalize">{t}</Table.ColumnHeader>
                          ))}
                          <Table.ColumnHeader color="fg.muted" fontSize="xs" px={3} py={2}>Status</Table.ColumnHeader>
                          <Table.ColumnHeader color="fg.muted" fontSize="xs" px={3} py={2}>Priority / Due</Table.ColumnHeader>
                          <Table.ColumnHeader px={3} py={2} />
                        </Table.Row>
                      </Table.Header>
                      <Table.Body>
                        {[...groupedAssignments.entries()].map(([annotatorId, taskMap]) => {
                          const u = users.find((x) => x.id === annotatorId);
                          const allStatuses = Object.values(taskMap).filter(Boolean).map((a) => a!.status);
                          const overallStatus = allStatuses.every((s) => s === "completed")
                            ? "completed"
                            : allStatuses.some((s) => s === "in_progress")
                            ? "in_progress"
                            : "pending";
                          return (
                            <Table.Row key={annotatorId} _hover={{ bg: "bg.muted" }}>
                              <Table.Cell px={4} py={2}>
                                <Text fontSize="sm" color="fg">{u?.username ?? `user_${annotatorId}`}</Text>
                              </Table.Cell>
                              {TASK_TYPES.map((t) => (
                                <Table.Cell key={t} px={3} py={2}>
                                  {taskMap[t] ? (
                                    <Flex align="center" gap={1}>
                                      <Box
                                        w="2" h="2" rounded="full"
                                        bg={taskMap[t]!.status === "completed" ? "green.400" : taskMap[t]!.status === "in_progress" ? "orange.400" : "fg.muted"}
                                      />
                                      {taskMap[t]!.status === "completed" && (
                                        <Button
                                          size="xs"
                                          variant="ghost"
                                          color="orange.400"
                                          p={0}
                                          minW="auto"
                                          loading={reopening.has(taskMap[t]!.id)}
                                          onClick={() => reopenAssignment(taskMap[t]!.id)}
                                          title="Reopen task"
                                        >
                                          <RotateCcw size={11} />
                                        </Button>
                                      )}
                                      <Button
                                        size="xs"
                                        variant="ghost"
                                        color="red.400"
                                        p={0}
                                        minW="auto"
                                        onClick={() => removeAssignment(taskMap[t]!.id)}
                                      >
                                        <Trash2 size={12} />
                                      </Button>
                                    </Flex>
                                  ) : (
                                    <Box w="2" h="2" rounded="full" bg="bg.muted" />
                                  )}
                                </Table.Cell>
                              ))}
                              <Table.Cell px={3} py={2}>{statusBadge(overallStatus)}</Table.Cell>
                              <Table.Cell px={3} py={2}>
                                {editMetaKey === annotatorId ? (
                                  <Flex direction="column" gap={1}>
                                    <Select.Root
                                      collection={priorityCollection}
                                      value={editPriority}
                                      onValueChange={d => setEditPriority(d.value)}
                                      size="xs"
                                    >
                                      <Select.HiddenSelect />
                                      <Select.Control>
                                        <Select.Trigger bg="bg.muted" borderColor="border" color="fg" minW="80px">
                                          <Select.ValueText />
                                        </Select.Trigger>
                                      </Select.Control>
                                      <Portal>
                                        <Select.Positioner>
                                          <Select.Content bg="bg.subtle" borderColor="border">
                                            {priorityCollection.items.map(item => (
                                              <Select.Item key={item.value} item={item} color="fg" _hover={{ bg: "bg.muted" }} fontSize="xs">
                                                {item.label}
                                              </Select.Item>
                                            ))}
                                          </Select.Content>
                                        </Select.Positioner>
                                      </Portal>
                                    </Select.Root>
                                    <Input
                                      type="date"
                                      size="xs"
                                      value={editDueDate}
                                      onChange={e => setEditDueDate(e.target.value)}
                                      bg="bg.muted" borderColor="border" color="fg"
                                    />
                                    <HStack gap={1}>
                                      <Button size="xs" colorPalette="blue" loading={savingMeta} onClick={() => saveMetaForAnnotator(annotatorId)}>Save</Button>
                                      <Button size="xs" variant="ghost" onClick={() => setEditMetaKey(null)}>✕</Button>
                                    </HStack>
                                  </Flex>
                                ) : (
                                  <Flex direction="column" gap={0.5}>
                                    {(() => {
                                      const firstTask = Object.values(taskMap).find(Boolean);
                                      const p = firstTask?.priority ?? "normal";
                                      const d = firstTask?.due_date;
                                      return (
                                        <>
                                          <Box
                                            cursor="pointer"
                                            onClick={() => {
                                              setEditMetaKey(annotatorId);
                                              setEditPriority([p]);
                                              setEditDueDate(d ? d.split("T")[0] : "");
                                            }}
                                          >
                                            {priorityBadge(p)}
                                          </Box>
                                          {d && (
                                            <Flex align="center" gap={1}>
                                              <Calendar size={10} color="var(--chakra-colors-fg-muted)" />
                                              <Text fontSize="10px" color="fg.muted">{new Date(d).toLocaleDateString()}</Text>
                                            </Flex>
                                          )}
                                        </>
                                      );
                                    })()}
                                  </Flex>
                                )}
                              </Table.Cell>
                              <Table.Cell px={3} py={2} />
                            </Table.Row>
                          );
                        })}
                      </Table.Body>
                    </Table.Root>
                  </Box>
                )}

                {/* Add annotator */}
                <Box borderWidth="1px" borderColor="border" borderStyle="dashed" rounded="md" p={4} mb={5}>
                  <Text fontSize="sm" fontWeight="semibold" color="fg" mb={3}>Add Annotator</Text>
                  <Flex gap={3} align="end" wrap="wrap">
                    {/* Annotator picker */}
                    <Box flex={1} minW="160px">
                      <Text fontSize="xs" color="fg.muted" mb={1}>Annotator</Text>
                      <Select.Root
                        collection={annotatorOptions}
                        value={newAnnotatorId}
                        onValueChange={(d) => setNewAnnotatorId(d.value)}
                        size="sm"
                      >
                        <Select.HiddenSelect />
                        <Select.Control>
                          <Select.Trigger bg="bg.muted" borderColor="border" color="fg">
                            <Select.ValueText placeholder="Select annotator…" />
                          </Select.Trigger>
                        </Select.Control>
                        <Portal>
                          <Select.Positioner>
                            <Select.Content bg="bg.subtle" borderColor="border">
                              {annotatorOptions.items.map((item) => (
                                <Select.Item key={item.value} item={item} color="fg" _hover={{ bg: "bg.muted" }}>
                                  {item.label}
                                </Select.Item>
                              ))}
                            </Select.Content>
                          </Select.Positioner>
                        </Portal>
                      </Select.Root>
                    </Box>

                    {/* Task combo picker */}
                    <Box flex={1} minW="220px">
                      <Text fontSize="xs" color="fg.muted" mb={1}>Task Combination</Text>
                      <Select.Root
                        collection={comboCollection}
                        value={newComboLabel}
                        onValueChange={(d) => setNewComboLabel(d.value)}
                        size="sm"
                      >
                        <Select.HiddenSelect />
                        <Select.Control>
                          <Select.Trigger bg="bg.muted" borderColor="border" color="fg">
                            <Select.ValueText placeholder="Select task combo…" />
                          </Select.Trigger>
                        </Select.Control>
                        <Portal>
                          <Select.Positioner>
                            <Select.Content bg="bg.subtle" borderColor="border">
                              {comboCollection.items.map((item) => (
                                <Select.Item key={item.value} item={item} color="fg" _hover={{ bg: "bg.muted" }}>
                                  {item.label}
                                </Select.Item>
                              ))}
                            </Select.Content>
                          </Select.Positioner>
                        </Portal>
                      </Select.Root>
                    </Box>

                    {/* Priority */}
                    <Box minW="110px">
                      <Text fontSize="xs" color="fg.muted" mb={1}>Priority</Text>
                      <Select.Root
                        collection={priorityCollection}
                        value={newPriority}
                        onValueChange={(d) => setNewPriority(d.value)}
                        size="sm"
                      >
                        <Select.HiddenSelect />
                        <Select.Control>
                          <Select.Trigger bg="bg.muted" borderColor="border" color="fg">
                            <Select.ValueText />
                          </Select.Trigger>
                        </Select.Control>
                        <Portal>
                          <Select.Positioner>
                            <Select.Content bg="bg.subtle" borderColor="border">
                              {priorityCollection.items.map((item) => (
                                <Select.Item key={item.value} item={item} color="fg" _hover={{ bg: "bg.muted" }}>
                                  {item.label}
                                </Select.Item>
                              ))}
                            </Select.Content>
                          </Select.Positioner>
                        </Portal>
                      </Select.Root>
                    </Box>

                    {/* Due date */}
                    <Box minW="140px">
                      <Text fontSize="xs" color="fg.muted" mb={1}>Due date (optional)</Text>
                      <Input
                        type="date"
                        size="sm"
                        value={newDueDate}
                        onChange={e => setNewDueDate(e.target.value)}
                        bg="bg.muted" borderColor="border" color="fg"
                      />
                    </Box>

                    <Button
                      colorPalette="blue"
                      size="sm"
                      loading={saving}
                      disabled={!newAnnotatorId[0] || selectedTasks.length === 0 || emotionBlocked}
                      onClick={addAnnotator}
                    >
                      <Plus size={14} />
                      Add
                    </Button>
                  </Flex>

                  {/* Inline warning when emotion is blocked */}
                  {emotionBlocked && (
                    <Flex align="center" gap={2} mt={3} px={3} py={2} rounded="md" bg="orange.900" borderWidth="1px" borderColor="orange.700">
                      <AlertTriangle size={14} color="var(--chakra-colors-orange-400)" />
                      <Text fontSize="xs" color="orange.300">
                        Emotion tasks require speaker segments to be locked first. Lock the speaker task above.
                      </Text>
                    </Flex>
                  )}

                  {/* Quick: assign emotion to all annotators already on this file */}
                  {selectedFile.collaborative_locked_speaker && groupedAssignments.size > 0 && (
                    <Flex align="center" gap={2} mt={3} pt={3} borderTopWidth="1px" borderColor="border">
                      <Button
                        size="xs"
                        colorPalette="purple"
                        variant="subtle"
                        loading={assigningEmotionAll}
                        onClick={assignEmotionToAll}
                      >
                        <Zap size={12} />
                        Assign emotion to all {groupedAssignments.size} annotator{groupedAssignments.size !== 1 ? "s" : ""}
                      </Button>
                      <Text fontSize="10px" color="fg.muted">skips annotators already assigned</Text>
                    </Flex>
                  )}
                </Box>

                {/* Coverage summary + warnings */}
                <Box>
                  <Text fontSize="xs" color="fg.muted" fontWeight="semibold" mb={2}>Task Coverage Summary</Text>
                  {TASK_TYPES.map((t) => {
                    const assigned = assignments.filter((a) => a.task_type === t);
                    const names = assigned
                      .map((a) => users.find((u) => u.id === a.annotator_id)?.username)
                      .filter(Boolean)
                      .join(", ");
                    return (
                      <Text key={t} fontSize="xs" color="fg.muted" mb={0.5}>
                        <Text as="span" color="fg" textTransform="capitalize">{t}</Text>
                        {": "}
                        {assigned.length > 0 ? `${assigned.length} annotator${assigned.length > 1 ? "s" : ""} (${names})` : "none"}
                      </Text>
                    );
                  })}

                  {emotionAnnotators.length < 2 && emotionAnnotators.length > 0 && (
                    <Flex align="center" gap={2} mt={3} px={3} py={2} rounded="md" bg="red.900" borderWidth="1px" borderColor="red.700">
                      <AlertTriangle size={14} color="var(--chakra-colors-red-400)" />
                      <Text fontSize="xs" color="red.300">
                        Emotion has only {emotionAnnotators.length} annotator — 3+ recommended for reliable comparison.
                      </Text>
                    </Flex>
                  )}
                </Box>
              </Box>
            </Box>
          ) : (
            <Flex flex={1} align="center" justify="center">
              <Text color="fg.muted">Select a file to manage assignments.</Text>
            </Flex>
          )}
        </Flex>
      )}

      {/* ── Bulk Assign Modal ─────────────────────────────────────────────────── */}
      <Dialog.Root
        open={bulkOpen}
        onOpenChange={({ open }) => {
          if (!bulkSaving) { setBulkOpen(open); if (!open) resetBulk(); }
        }}
        size="xl"
      >
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content bg="bg.subtle" borderWidth="1px" borderColor="border" rounded="lg" maxW="960px" w="full">
            <Dialog.Header borderBottomWidth="1px" borderColor="border" pb={3}>
              <Dialog.Title fontSize="md" color="fg">Bulk Assign Tasks</Dialog.Title>
            </Dialog.Header>

            <Dialog.Body pt={4} pb={2}>
              <Flex gap={5} align="start" minH="420px">

                {/* ── Left: file selection ── */}
                <Box flex={1} minW={0}>
                  <HStack mb={2} justify="space-between">
                    <Text fontSize="xs" fontWeight="semibold" color="fg">
                      Files ({bulkSelected.size} / {audioFiles.length} selected)
                    </Text>
                    <HStack gap={2}>
                      <Button size="xs" variant="ghost" colorPalette="blue"
                        onClick={() => setBulkSelected(new Set(filteredFiles.map(f => f.id)))}>
                        Select all
                      </Button>
                      <Button size="xs" variant="ghost" colorPalette="gray"
                        onClick={() => setBulkSelected(new Set())}>
                        Clear
                      </Button>
                    </HStack>
                  </HStack>

                  <Input
                    size="sm" placeholder="Search files…" mb={2}
                    value={bulkSearch} onChange={e => setBulkSearch(e.target.value)}
                    bg="bg.muted" borderColor="border" color="fg"
                  />

                  <Box
                    borderWidth="1px" borderColor="border" rounded="md" overflow="auto"
                    maxH="340px"
                    css={{
                      "&::-webkit-scrollbar": { width: "4px" },
                      "&::-webkit-scrollbar-thumb": { background: "#4a4c54", borderRadius: "999px" },
                    }}
                  >
                    {filteredFiles.length === 0 ? (
                      <Box px={3} py={6} textAlign="center">
                        <Text fontSize="xs" color="fg.muted">No files match.</Text>
                      </Box>
                    ) : filteredFiles.map(f => {
                      const checked = bulkSelected.has(f.id);
                      return (
                        <HStack
                          key={f.id}
                          px={3} py={2} gap={3} cursor="pointer"
                          bg={checked ? "blue.900" : "transparent"}
                          borderBottomWidth="1px" borderColor="border"
                          _hover={{ bg: checked ? "blue.900" : "bg.muted" }}
                          onClick={() => setBulkSelected(prev => {
                            const next = new Set(prev);
                            if (next.has(f.id)) next.delete(f.id); else next.add(f.id);
                            return next;
                          })}
                        >
                          <Checkbox.Root checked={checked} onCheckedChange={() => {}} size="sm" pointerEvents="none">
                            <Checkbox.HiddenInput />
                            <Checkbox.Control />
                          </Checkbox.Root>
                          <Box flex={1} minW={0}>
                            <Text fontSize="xs" color="fg" fontFamily="mono" truncate>{f.filename}</Text>
                            <Text fontSize="10px" color="fg.muted">{f.language ?? "—"} · {f.num_speakers ?? "?"}spk</Text>
                          </Box>
                        </HStack>
                      );
                    })}
                  </Box>
                </Box>

                {/* ── Middle: annotator selection ── */}
                <Box flex={1} minW={0}>
                  <HStack mb={2} justify="space-between">
                    <Text fontSize="xs" fontWeight="semibold" color="fg">
                      Annotators ({bulkAnnotatorIds.size} / {annotators.length} selected)
                    </Text>
                    <HStack gap={2}>
                      <Button size="xs" variant="ghost" colorPalette="blue"
                        onClick={() => setBulkAnnotatorIds(new Set(filteredAnnotators.map(a => a.id)))}>
                        Select all
                      </Button>
                      <Button size="xs" variant="ghost" colorPalette="gray"
                        onClick={() => setBulkAnnotatorIds(new Set())}>
                        Clear
                      </Button>
                    </HStack>
                  </HStack>

                  <Input
                    size="sm" placeholder="Search annotators…" mb={2}
                    value={bulkAnnotatorSearch} onChange={e => setBulkAnnotatorSearch(e.target.value)}
                    bg="bg.muted" borderColor="border" color="fg"
                  />

                  <Box
                    borderWidth="1px" borderColor="border" rounded="md" overflow="auto"
                    maxH="340px"
                    css={{
                      "&::-webkit-scrollbar": { width: "4px" },
                      "&::-webkit-scrollbar-thumb": { background: "#4a4c54", borderRadius: "999px" },
                    }}
                  >
                    {filteredAnnotators.length === 0 ? (
                      <Box px={3} py={6} textAlign="center">
                        <Text fontSize="xs" color="fg.muted">No annotators match.</Text>
                      </Box>
                    ) : filteredAnnotators.map(a => {
                      const checked = bulkAnnotatorIds.has(a.id);
                      return (
                        <HStack
                          key={a.id}
                          px={3} py={2} gap={3} cursor="pointer"
                          bg={checked ? "blue.900" : "transparent"}
                          borderBottomWidth="1px" borderColor="border"
                          _hover={{ bg: checked ? "blue.900" : "bg.muted" }}
                          onClick={() => setBulkAnnotatorIds(prev => {
                            const next = new Set(prev);
                            if (next.has(a.id)) next.delete(a.id); else next.add(a.id);
                            return next;
                          })}
                        >
                          <Checkbox.Root checked={checked} onCheckedChange={() => {}} size="sm" pointerEvents="none">
                            <Checkbox.HiddenInput />
                            <Checkbox.Control />
                          </Checkbox.Root>
                          <Text fontSize="xs" color="fg">{a.username}</Text>
                        </HStack>
                      );
                    })}
                  </Box>
                </Box>

                {/* ── Right: combo + summary ── */}
                <Box w="200px" flexShrink={0}>
                  <Text fontSize="xs" fontWeight="semibold" color="fg" mb={3}>Task Combination</Text>

                  <Box mb={4}>
                    <Select.Root
                      collection={comboCollection}
                      value={bulkComboLabel}
                      onValueChange={d => setBulkComboLabel(d.value)}
                      size="sm"
                    >
                      <Select.HiddenSelect />
                      <Select.Control>
                        <Select.Trigger bg="bg.muted" borderColor="border" color="fg">
                          <Select.ValueText placeholder="Select combo…" />
                        </Select.Trigger>
                      </Select.Control>
                      <Portal>
                        <Select.Positioner>
                          <Select.Content bg="bg.subtle" borderColor="border">
                            {comboCollection.items.map(item => (
                              <Select.Item key={item.value} item={item} color="fg" _hover={{ bg: "bg.muted" }}>
                                {item.label}
                              </Select.Item>
                            ))}
                          </Select.Content>
                        </Select.Positioner>
                      </Portal>
                    </Select.Root>
                  </Box>

                  {/* Summary */}
                  {bulkSelected.size > 0 && bulkAnnotatorIds.size > 0 && bulkTasks.length > 0 && (
                    <Box px={3} py={2} bg="teal.900" borderWidth="1px" borderColor="teal.700" rounded="md" mb={3}>
                      <Text fontSize="xs" color="teal.300">
                        <strong>{bulkTasks.join(" + ")}</strong> → <strong>{bulkAnnotatorIds.size}</strong> annotator{bulkAnnotatorIds.size !== 1 ? "s" : ""} × <strong>{bulkSelected.size}</strong> file{bulkSelected.size !== 1 ? "s" : ""}
                      </Text>
                      <Text fontSize="10px" color="teal.400" mt={1}>
                        {bulkSelected.size * bulkAnnotatorIds.size} total assignments. Existing ones skipped.
                      </Text>
                    </Box>
                  )}

                  {/* Emotion warning */}
                  {bulkTasks.includes("emotion") && (
                    <Flex align="center" gap={2} px={3} py={2} bg="orange.900" borderWidth="1px" borderColor="orange.700" rounded="md" mb={3}>
                      <AlertTriangle size={13} color="var(--chakra-colors-orange-400)" />
                      <Text fontSize="10px" color="orange.300">
                        Emotion tasks will be created for all selected files. Ensure speaker is locked per file before annotators begin.
                      </Text>
                    </Flex>
                  )}
                </Box>
              </Flex>

              {/* Progress bar */}
              {bulkProgress && (
                <Box mt={4} borderTopWidth="1px" borderColor="border" pt={3}>
                  <HStack mb={1} justify="space-between">
                    <Text fontSize="xs" color="fg.muted">
                      {bulkProgress.done < bulkProgress.total
                        ? `Processing ${bulkProgress.done} / ${bulkProgress.total}…`
                        : `Done — ${bulkProgress.total - bulkProgress.errors.length} succeeded, ${bulkProgress.errors.length} skipped/failed`}
                    </Text>
                    {bulkSaving && (
                      <Button size="xs" colorPalette="red" variant="ghost"
                        onClick={() => { bulkAbort.current = true; }}>
                        Cancel
                      </Button>
                    )}
                  </HStack>
                  <Progress.Root
                    value={bulkProgress.total > 0 ? (bulkProgress.done / bulkProgress.total) * 100 : 0}
                    size="sm" colorPalette={bulkProgress.errors.length > 0 ? "orange" : "teal"}
                  >
                    <Progress.Track rounded="full">
                      <Progress.Range />
                    </Progress.Track>
                  </Progress.Root>
                  {bulkProgress.errors.length > 0 && (
                    <Box mt={2} maxH="80px" overflowY="auto">
                      {bulkProgress.errors.map((e, i) => (
                        <Text key={i} fontSize="10px" color="orange.300">{e}</Text>
                      ))}
                    </Box>
                  )}
                </Box>
              )}
            </Dialog.Body>

            <Dialog.Footer borderTopWidth="1px" borderColor="border" pt={3} gap={2}>
              <Button
                size="sm" variant="ghost"
                disabled={bulkSaving}
                onClick={() => { setBulkOpen(false); resetBulk(); }}
              >
                {bulkProgress && !bulkSaving ? "Close" : "Cancel"}
              </Button>
              <Button
                size="sm" colorPalette="teal"
                loading={bulkSaving}
                disabled={bulkSelected.size === 0 || bulkAnnotatorIds.size === 0 || bulkTasks.length === 0 || (bulkProgress !== null && !bulkSaving)}
                onClick={runBulkAssign}
              >
                <Users size={14} />
                Assign {bulkAnnotatorIds.size || "?"} annotator{bulkAnnotatorIds.size !== 1 ? "s" : ""} × {bulkSelected.size} file{bulkSelected.size !== 1 ? "s" : ""}
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Dialog.Root>
    </Box>
  );
}
