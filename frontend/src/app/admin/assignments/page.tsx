"use client";

import { useEffect, useState } from "react";
import {
  Badge,
  Box,
  Button,
  Checkbox,
  Flex,
  Heading,
  Select,
  Table,
  Text,
  Portal,
  createListCollection,
} from "@chakra-ui/react";
import { Plus, Trash2, AlertTriangle } from "lucide-react";
import api from "@/lib/axios";
import ToastWizard from "@/lib/toastWizard";

// ── Types ──────────────────────────────────────────────────────────────────

interface AudioFile {
  id: number;
  filename: string;
  subfolder: string | null;
  language: string | null;
  num_speakers: number | null;
  duration: number | null;
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
}

const TASK_TYPES = ["emotion", "gender", "speaker", "transcription"] as const;
type TaskType = typeof TASK_TYPES[number];

// ── Helpers ────────────────────────────────────────────────────────────────

function statusBadge(status: string) {
  const map: Record<string, string> = { completed: "green", in_progress: "orange", pending: "gray" };
  return <Badge colorPalette={map[status] ?? "gray"} size="sm">{status.replace("_", " ")}</Badge>;
}

// Group assignments by annotator for the right panel
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

// Coverage flags  E G S T
function coverageFlags(assignments: Assignment[]): string {
  const types = new Set(assignments.map((a) => a.task_type));
  return ["emotion", "gender", "speaker", "transcription"]
    .map((t) => (types.has(t) ? t[0].toUpperCase() : "·"))
    .join(" ");
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function AssignTasksPage() {
  const [audioFiles,   setAudioFiles]   = useState<AudioFile[]>([]);
  const [users,        setUsers]        = useState<User[]>([]);
  const [selectedFile, setSelectedFile] = useState<AudioFile | null>(null);
  const [assignments,  setAssignments]  = useState<Assignment[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [saving,       setSaving]       = useState(false);

  // New annotator selector
  const [newAnnotatorId, setNewAnnotatorId] = useState<string[]>([]);
  const [newTasks,       setNewTasks]       = useState<Set<TaskType>>(new Set(["emotion"]));

  useEffect(() => {
    Promise.all([api.get("/api/audio-files/"), api.get("/api/users/")])
      .then(([af, u]) => {
        setAudioFiles(af.data);
        setUsers(u.data);
        if (af.data.length > 0) setSelectedFile(af.data[0]);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedFile) return;
    api.get(`/api/assignments/?audio_file_id=${selectedFile.id}`)
      .then((r) => setAssignments(r.data));
  }, [selectedFile]);

  const annotators = users.filter((u) => u.role === "annotator" && u.is_active);
  const groupedAssignments = groupByAnnotator(assignments);

  const annotatorOptions = createListCollection({
    items: annotators
      .filter((u) => !groupedAssignments.has(u.id))
      .map((u) => ({ label: u.username, value: String(u.id) })),
  });

  async function addAnnotator() {
    if (!selectedFile || !newAnnotatorId[0] || newTasks.size === 0) return;
    setSaving(true);
    const tasks = [...newTasks];
    try {
      const results = await Promise.all(
        tasks.map((task_type) =>
          api.post("/api/assignments/", {
            audio_file_id: selectedFile.id,
            annotator_id: parseInt(newAnnotatorId[0]),
            task_type,
          }).catch((e) => {
            // 400 = already exists, skip silently
            if (e?.response?.status !== 400) throw e;
            return null;
          })
        )
      );
      const created = results.filter(Boolean).map((r) => r!.data);
      if (created.length > 0) {
        setAssignments((prev) => [...prev, ...created]);
        ToastWizard.standard("success", "Annotator assigned", `${tasks.join(", ")} tasks assigned.`, 3000, true);
      }
      setNewAnnotatorId([]);
      setNewTasks(new Set(["emotion"]));
    } catch {
      ToastWizard.standard("error", "Assignment failed", "Could not create assignment.", 3000, true);
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

  function toggleNewTask(t: TaskType) {
    setNewTasks((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t); else next.add(t);
      return next;
    });
  }

  // Coverage summary per task type
  const emotionAnnotators = assignments
    .filter((a) => a.task_type === "emotion")
    .map((a) => users.find((u) => u.id === a.annotator_id)?.username)
    .filter(Boolean);

  return (
    <Box p={8} h="full">
      <Heading size="lg" color="fg" mb={1}>Assign Tasks</Heading>
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
              <Text fontSize="sm" fontWeight="semibold" color="fg">Audio Files ({audioFiles.length})</Text>
            </Box>
            <Box overflow="auto" h="calc(100% - 48px)">
              {audioFiles.map((af) => {
                const isSelected = selectedFile?.id === af.id;
                return (
                  <Box
                    key={af.id}
                    px={4}
                    py={3}
                    cursor="pointer"
                    bg={isSelected ? "bg.muted" : "transparent"}
                    borderLeftWidth="3px"
                    borderLeftColor={isSelected ? "blue.400" : "transparent"}
                    _hover={{ bg: "bg.muted" }}
                    onClick={() => setSelectedFile(af)}
                    borderBottomWidth="1px"
                    borderBottomColor="border"
                  >
                    <Text fontSize="sm" color="fg" fontFamily="mono" mb={0.5}>
                      {af.filename.replace(/\.[^.]+$/, "")}
                    </Text>
                    <Flex gap={3} align="center">
                      <Text fontSize="xs" color="fg.muted">{af.language ?? "—"}</Text>
                      <Text fontSize="xs" color="fg.muted">{af.num_speakers ?? "?"} spk</Text>
                      <Text fontSize="xs" color="fg.muted" fontFamily="mono">
                        {af.duration ? `${af.duration.toFixed(0)}s` : ""}
                      </Text>
                    </Flex>
                  </Box>
                );
              })}
            </Box>
          </Box>

          {/* ── Right: assignment panel ──────────────────────────── */}
          {selectedFile ? (
            <Box flex={1} bg="bg.subtle" borderWidth="1px" borderColor="border" rounded="lg" overflow="hidden" h="full">
              {/* File info bar */}
              <Box px={5} py={3} borderBottomWidth="1px" borderColor="border">
                <Flex gap={4} align="center">
                  <Text fontSize="sm" fontWeight="semibold" color="fg" fontFamily="mono">
                    {selectedFile.filename.replace(/\.[^.]+$/, "")}
                  </Text>
                  <Badge colorPalette="blue" size="sm">{selectedFile.language ?? "—"}</Badge>
                  <Text fontSize="xs" color="fg.muted">{selectedFile.duration?.toFixed(1)}s</Text>
                  <Text fontSize="xs" color="fg.muted">{selectedFile.num_speakers} speakers</Text>
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
                                      <Box w="2" h="2" rounded="full" bg="green.400" />
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
                    <Box flex={1} minW="180px">
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
                    <Box>
                      <Text fontSize="xs" color="fg.muted" mb={1}>Task Types</Text>
                      <Flex gap={2}>
                        {TASK_TYPES.map((t) => (
                          <Checkbox.Root
                            key={t}
                            checked={newTasks.has(t)}
                            onCheckedChange={() => toggleNewTask(t)}
                            size="sm"
                          >
                            <Checkbox.HiddenInput />
                            <Checkbox.Control borderColor="border" />
                            <Checkbox.Label fontSize="xs" color="fg" textTransform="capitalize">{t}</Checkbox.Label>
                          </Checkbox.Root>
                        ))}
                      </Flex>
                    </Box>
                    <Button
                      colorPalette="blue"
                      size="sm"
                      loading={saving}
                      disabled={!newAnnotatorId[0] || newTasks.size === 0}
                      onClick={addAnnotator}
                    >
                      <Plus size={14} />
                      Add
                    </Button>
                  </Flex>
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
                    <Flex
                      align="center"
                      gap={2}
                      mt={3}
                      px={3}
                      py={2}
                      rounded="md"
                      bg="red.900"
                      borderWidth="1px"
                      borderColor="red.700"
                    >
                      <AlertTriangle size={14} color="var(--chakra-colors-red-400)" />
                      <Text fontSize="xs" color="red.300">
                        Emotion has only {emotionAnnotators.length} annotator — 3+ recommended for reliable comparison.
                      </Text>
                    </Flex>
                  )}

                  {emotionAnnotators.length === 0 && (
                    <Flex
                      align="center"
                      gap={2}
                      mt={3}
                      px={3}
                      py={2}
                      rounded="md"
                      bg="blue.900"
                      borderWidth="1px"
                      borderColor="blue.700"
                    >
                      <Text fontSize="xs" color="blue.300">
                        Collaborative tasks (Gender / Speaker / Transcription): 1 annotator is sufficient.
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
    </Box>
  );
}
