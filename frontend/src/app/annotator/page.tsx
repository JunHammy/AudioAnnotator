"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  Box,
  Button,
  Flex,
  Grid,
  Heading,
  Input,
  Table,
  Text,
} from "@chakra-ui/react";
import { Calendar } from "lucide-react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import api from "@/lib/axios";
import ToastWizard from "@/lib/toastWizard";
import { useSSE } from "@/context/sse";

// ── Types ──────────────────────────────────────────────────────────────────

interface Assignment {
  id: number;
  audio_file_id: number;
  task_type: string;
  status: string;
  created_at: string;
  completed_at: string | null;
  priority: string;
  due_date: string | null;
}

interface EmotionProgress {
  file_id: number;
  annotated: number;
  total: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────

const PRIORITY_ORDER: Record<string, number> = { high: 0, normal: 1, low: 2 };

function priorityBadge(priority: string) {
  const map: Record<string, string> = { high: "red", normal: "blue", low: "gray" };
  return <Badge colorPalette={map[priority] ?? "gray"} size="sm" variant="subtle">{priority}</Badge>;
}

function statusBadge(status: string) {
  const map: Record<string, string> = { completed: "green", in_progress: "orange", pending: "gray" };
  return (
    <Badge colorPalette={map[status] ?? "gray"} size="sm">
      {status.replace("_", " ")}
    </Badge>
  );
}

function actionLabel(status: string): string {
  if (status === "completed") return "View";
  if (status === "in_progress") return "Continue";
  return "Start";
}

function actionColor(status: string): string {
  if (status === "completed") return "gray";
  if (status === "in_progress") return "orange";
  return "blue";
}

// ── Stat Card ─────────────────────────────────────────────────────────────

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <Box bg="bg.subtle" borderWidth="1px" borderColor="border" rounded="lg" p={5}>
      <Text fontSize="sm" color="fg.muted" mb={1}>{label}</Text>
      <Text fontSize="2xl" fontWeight="bold" color={color}>{value}</Text>
    </Box>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function AnnotatorTasksPage() {
  const { user } = useAuth();
  const router = useRouter();
  const { on } = useSSE();
  const [assignments,    setAssignments]    = useState<Assignment[]>([]);
  const [filenameMap,    setFilenameMap]    = useState<Record<number, string>>({});
  const [adminResponseMap, setAdminResponseMap] = useState<Record<number, string | null>>({});
  const [emotionProgress, setEmotionProgress] = useState<Record<number, EmotionProgress>>({});
  const [loading,        setLoading]        = useState(true);
  const [filter,         setFilter]         = useState<"all" | "pending" | "in_progress" | "completed">("all");
  const [search,         setSearch]         = useState("");

  const fetchAll = useCallback(() => {
    Promise.all([
      api.get("/api/assignments/"),
      api.get("/api/audio-files"),
      api.get("/api/segments/emotion-progress"),
    ]).then(([aRes, fRes, epRes]) => {
      setAssignments(aRes.data);
      const nameMap: Record<number, string> = {};
      const respMap: Record<number, string | null> = {};
      for (const f of fRes.data) {
        nameMap[f.id] = f.filename;
        respMap[f.id] = f.admin_response ?? null;
      }
      setFilenameMap(nameMap);
      setAdminResponseMap(respMap);
      const progMap: Record<number, EmotionProgress> = {};
      for (const p of epRes.data) progMap[p.file_id] = p;
      setEmotionProgress(progMap);
    }).catch((err) => {
      // 401/503/network errors are handled by the axios interceptor (redirect to login).
      // Only show a toast for unexpected server errors so the user isn't double-notified.
      const status = err?.response?.status;
      if (status === 401 || status === 403 || status === 503 || !err?.response) return;
      ToastWizard.standard("error", "Failed to load tasks", "Could not fetch your assignments. Please refresh.", 5000);
    }).finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Re-fetch when a new assignment arrives via SSE
  useEffect(() => on("assignment_created", fetchAll), [on, fetchAll]);

  const stats = {
    assigned:    assignments.length,
    in_progress: assignments.filter((a) => a.status === "in_progress").length,
    completed:   assignments.filter((a) => a.status === "completed").length,
    pending:     assignments.filter((a) => a.status === "pending").length,
  };

  const filtered = assignments
    .filter(a => filter === "all" || a.status === filter)
    .filter(a => !search || (filenameMap[a.audio_file_id] ?? "").toLowerCase().includes(search.toLowerCase()));

  // Group tasks by audio file to show combined task types per row
  const groupedRaw = new Map<number, Assignment[]>();
  for (const a of filtered) {
    if (!groupedRaw.has(a.audio_file_id)) groupedRaw.set(a.audio_file_id, []);
    groupedRaw.get(a.audio_file_id)!.push(a);
  }

  // Sort groups: high priority first, then by due_date ascending (null last)
  const grouped = new Map(
    [...groupedRaw.entries()].sort(([, aArr], [, bArr]) => {
      const aPriority = PRIORITY_ORDER[aArr[0]?.priority ?? "normal"] ?? 1;
      const bPriority = PRIORITY_ORDER[bArr[0]?.priority ?? "normal"] ?? 1;
      if (aPriority !== bPriority) return aPriority - bPriority;
      const aDue = aArr[0]?.due_date;
      const bDue = bArr[0]?.due_date;
      if (!aDue && !bDue) return 0;
      if (!aDue) return 1;
      if (!bDue) return -1;
      return new Date(aDue).getTime() - new Date(bDue).getTime();
    })
  );

  const FILTERS = ["all", "pending", "in_progress", "completed"] as const;

  return (
    <Box p={{ base: 4, md: 8 }} maxW="1000px" h="100%" overflowY="auto">
      <Heading size="lg" color="fg" mb={1}>My Tasks</Heading>
      <Text color="fg.muted" mb={6}>Welcome back, {user?.username}</Text>

      {/* Stat cards */}
      <Grid templateColumns={{ base: "repeat(2, 1fr)", md: "repeat(4, 1fr)" }} gap={4} mb={8}>
        <StatCard label="Assigned"    value={stats.assigned}    color="fg" />
        <StatCard label="In Progress" value={stats.in_progress} color="orange.400" />
        <StatCard label="Completed"   value={stats.completed}   color="green.400" />
        <StatCard label="Pending"     value={stats.pending}     color="fg.muted" />
      </Grid>

      {/* Filter bar + search */}
      <Flex gap={2} mb={4} align="center" flexWrap="wrap">
        {FILTERS.map((f) => (
          <Button
            key={f}
            size="sm"
            variant={filter === f ? "solid" : "outline"}
            colorPalette={filter === f ? "blue" : "gray"}
            onClick={() => setFilter(f)}
          >
            {f === "all" ? "All" : f.replace("_", " ").replace(/\b\w/g, (c) => c.toUpperCase())}
          </Button>
        ))}
        <Input
          size="sm"
          placeholder="Search by filename…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          maxW={{ base: "full", sm: "220px" }}
          ml={{ base: 0, sm: "auto" }}
          bg="bg.subtle"
          borderColor="border"
          color="fg"
        />
      </Flex>

      {/* Task table */}
      <Box bg="bg.subtle" borderWidth="1px" borderColor="border" rounded="lg" overflow="hidden">
        {loading ? (
          <Box px={5} py={8} textAlign="center"><Text color="fg.muted">Loading…</Text></Box>
        ) : (
          <Box overflowX="auto">
          <Table.Root size="sm">
            <Table.Header>
              <Table.Row>
                {["File", "Task Types", "Priority", "Status", "Assigned", "Action"].map((h) => (
                  <Table.ColumnHeader key={h} color="fg.muted" fontSize="xs" px={4} py={3}>{h}</Table.ColumnHeader>
                ))}
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {[...grouped.entries()].map(([fileId, tasks]) => {
                const allStatuses = tasks.map((t) => t.status);
                const overallStatus = allStatuses.every((s) => s === "completed")
                  ? "completed"
                  : allStatuses.some((s) => s === "in_progress")
                  ? "in_progress"
                  : "pending";
                const taskTypes = tasks.map((t) => t.task_type).join(", ");
                const earliestDate = tasks.reduce(
                  (min, t) => (t.created_at < min ? t.created_at : min),
                  tasks[0].created_at,
                );

                return (
                  <Table.Row key={fileId} _hover={{ bg: "bg.muted" }}>
                    <Table.Cell px={4} py={3}>
                      <Text fontSize="sm" color="fg" fontFamily="mono">
                        {filenameMap[fileId] ?? `file_${fileId}`}
                      </Text>
                      {adminResponseMap[fileId] && (
                        <Badge size="xs" colorPalette="blue" variant="subtle" mt={1}>
                          💬 Admin replied
                        </Badge>
                      )}
                    </Table.Cell>
                    <Table.Cell px={4} py={3}>
                      <Flex gap={1} wrap="wrap" mb={tasks.some(t => t.task_type === "emotion") && emotionProgress[fileId] ? 1 : 0}>
                        {tasks.map((t) => (
                          <Badge key={t.id} colorPalette="blue" size="sm" variant="outline">
                            {t.task_type}
                          </Badge>
                        ))}
                      </Flex>
                      {tasks.some(t => t.task_type === "emotion") && emotionProgress[fileId] && (
                        <Text fontSize="10px" color="fg.muted">
                          {emotionProgress[fileId].annotated} / {emotionProgress[fileId].total} segments labelled
                        </Text>
                      )}
                    </Table.Cell>
                    <Table.Cell px={4} py={3}>
                      {(() => {
                        const p = tasks[0]?.priority ?? "normal";
                        const d = tasks[0]?.due_date;
                        return (
                          <Flex direction="column" gap={0.5}>
                            {priorityBadge(p)}
                            {d && (
                              <Flex align="center" gap={1}>
                                <Calendar size={10} color="var(--chakra-colors-fg-muted)" />
                                <Text fontSize="10px" color={new Date(d) < new Date() ? "red.400" : "fg.muted"}>
                                  {new Date(d).toLocaleDateString()}
                                </Text>
                              </Flex>
                            )}
                          </Flex>
                        );
                      })()}
                    </Table.Cell>
                    <Table.Cell px={4} py={3}>{statusBadge(overallStatus)}</Table.Cell>
                    <Table.Cell px={4} py={3}>
                      <Text fontSize="xs" color="fg.muted">
                        {new Date(earliestDate).toLocaleDateString()}
                      </Text>
                    </Table.Cell>
                    <Table.Cell px={4} py={3}>
                      <Button
                        size="xs"
                        colorPalette={actionColor(overallStatus)}
                        variant={overallStatus === "completed" ? "outline" : "solid"}
                        onClick={() => router.push(`/annotator/annotate?file=${fileId}`)}
                      >
                        {actionLabel(overallStatus)} →
                      </Button>
                    </Table.Cell>
                  </Table.Row>
                );
              })}
              {grouped.size === 0 && (
                <Table.Row>
                  <Table.Cell colSpan={6} px={4} py={8} textAlign="center">
                    <Text color="fg.muted">
                      {filter === "all" ? "No tasks assigned yet." : `No ${filter.replace("_", " ")} tasks.`}
                    </Text>
                  </Table.Cell>
                </Table.Row>
              )}
            </Table.Body>
          </Table.Root>
          </Box>
        )}
      </Box>
    </Box>
  );
}
