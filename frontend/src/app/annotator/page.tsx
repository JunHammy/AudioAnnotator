"use client";

import { useEffect, useState } from "react";
import {
  Badge,
  Box,
  Button,
  Flex,
  Grid,
  Heading,
  Table,
  Text,
} from "@chakra-ui/react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import api from "@/lib/axios";

// ── Types ──────────────────────────────────────────────────────────────────

interface Assignment {
  id: number;
  audio_file_id: number;
  task_type: string;
  status: string;
  created_at: string;
  completed_at: string | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────

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
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [filter,      setFilter]      = useState<"all" | "pending" | "in_progress" | "completed">("all");

  useEffect(() => {
    api.get("/api/assignments/")
      .then((r) => setAssignments(r.data))
      .finally(() => setLoading(false));
  }, []);

  const stats = {
    assigned:    assignments.length,
    in_progress: assignments.filter((a) => a.status === "in_progress").length,
    completed:   assignments.filter((a) => a.status === "completed").length,
    pending:     assignments.filter((a) => a.status === "pending").length,
  };

  const filtered = filter === "all"
    ? assignments
    : assignments.filter((a) => a.status === filter);

  // Group tasks by audio file to show combined task types per row
  const grouped = new Map<number, Assignment[]>();
  for (const a of filtered) {
    if (!grouped.has(a.audio_file_id)) grouped.set(a.audio_file_id, []);
    grouped.get(a.audio_file_id)!.push(a);
  }

  const FILTERS = ["all", "pending", "in_progress", "completed"] as const;

  return (
    <Box p={8} maxW="1000px">
      <Heading size="lg" color="fg" mb={1}>My Tasks</Heading>
      <Text color="fg.muted" mb={6}>Welcome back, {user?.username}</Text>

      {/* Stat cards */}
      <Grid templateColumns="repeat(4, 1fr)" gap={4} mb={8}>
        <StatCard label="Assigned"    value={stats.assigned}    color="fg" />
        <StatCard label="In Progress" value={stats.in_progress} color="orange.400" />
        <StatCard label="Completed"   value={stats.completed}   color="green.400" />
        <StatCard label="Pending"     value={stats.pending}     color="fg.muted" />
      </Grid>

      {/* Filter bar */}
      <Flex gap={2} mb={4}>
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
      </Flex>

      {/* Task table */}
      <Box bg="bg.subtle" borderWidth="1px" borderColor="border" rounded="lg" overflow="hidden">
        {loading ? (
          <Box px={5} py={8} textAlign="center"><Text color="fg.muted">Loading…</Text></Box>
        ) : (
          <Table.Root size="sm">
            <Table.Header>
              <Table.Row>
                {["File", "Task Types", "Status", "Assigned", "Action"].map((h) => (
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
                        file_{fileId}
                      </Text>
                    </Table.Cell>
                    <Table.Cell px={4} py={3}>
                      <Flex gap={1} wrap="wrap">
                        {tasks.map((t) => (
                          <Badge key={t.id} colorPalette="blue" size="sm" variant="outline">
                            {t.task_type}
                          </Badge>
                        ))}
                      </Flex>
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
                  <Table.Cell colSpan={5} px={4} py={8} textAlign="center">
                    <Text color="fg.muted">
                      {filter === "all" ? "No tasks assigned yet." : `No ${filter.replace("_", " ")} tasks.`}
                    </Text>
                  </Table.Cell>
                </Table.Row>
              )}
            </Table.Body>
          </Table.Root>
        )}
      </Box>
    </Box>
  );
}
