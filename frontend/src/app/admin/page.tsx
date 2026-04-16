"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Badge,
  Box,
  Flex,
  Grid,
  Heading,
  Progress,
  Table,
  Text,
} from "@chakra-ui/react";
import { AlertTriangle, Database } from "lucide-react";
import api from "@/lib/axios";

// ── Types ──────────────────────────────────────────────────────────────────

interface DashboardData {
  stats: {
    total_files: number;
    assigned_files: number;
    completed_assignments: number;
    flagged_segments: number;
    low_annotator_files: number;
  };
  task_breakdown: Record<string, { total: number; done: number }>;
  recent_activity: {
    id: number;
    audio_file_id: number;
    filename: string;
    annotator: string;
    task_type: string;
    status: string;
    created_at: string;
  }[];
  dataset_progress: {
    dataset_id: number | null;
    dataset_name: string;
    total_files: number;
    total_assignments: number;
    completed_assignments: number;
    completion_rate: number;
  }[];
  annotator_summary: {
    id: number;
    username: string;
    is_active: boolean;
    assigned: number;
    completed: number;
    created_at: string;
  }[];
}

// ── Helpers ────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  return `${Math.floor(hrs / 24)} days ago`;
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    completed: "green",
    in_progress: "orange",
    pending: "gray",
  };
  return (
    <Badge colorPalette={map[status] ?? "gray"} size="sm">
      {status.replace("_", " ")}
    </Badge>
  );
}

// ── Stat Card ─────────────────────────────────────────────────────────────

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <Box bg="bg.subtle" borderWidth="1px" borderColor="border" rounded="lg" p={5}>
      <Text fontSize="sm" color="fg.muted" mb={1}>{label}</Text>
      <Text fontSize="3xl" fontWeight="bold" color={color}>{value.toLocaleString()}</Text>
    </Box>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function AdminDashboard() {
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get("/api/admin/dashboard")
      .then((r) => setData(r.data))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <Box p={8}>
        <Text color="fg.muted">Loading dashboard…</Text>
      </Box>
    );
  }

  if (!data) {
    return (
      <Box p={8}>
        <Text color="red.400">Failed to load dashboard data.</Text>
      </Box>
    );
  }

  return (
    <Box p={8} maxW="1200px">
      <Heading size="lg" color="fg" mb={1}>Admin Dashboard</Heading>
      <Text color="fg.muted" mb={6}>Overview of annotation progress</Text>

      {/* Stat cards */}
      <Grid templateColumns="repeat(5, 1fr)" gap={4} mb={8}>
        <StatCard label="Total Files"           value={data.stats.total_files}            color="fg" />
        <StatCard label="Files Assigned"        value={data.stats.assigned_files}         color="blue.400" />
        <StatCard label="Completed Assignments" value={data.stats.completed_assignments}  color="green.400" />
        <StatCard label="Flagged Segments"      value={data.stats.flagged_segments}       color="red.400" />
        {/* Clickable warning card — links to review page */}
        <Box
          bg="bg.subtle" borderWidth="1px" borderColor="border" rounded="lg" p={5}
          cursor={data.stats.low_annotator_files > 0 ? "pointer" : "default"}
          _hover={data.stats.low_annotator_files > 0 ? { borderColor: "orange.500", bg: "bg.muted" } : {}}
          transition="all 0.15s"
          onClick={() => data.stats.low_annotator_files > 0 && router.push("/admin/review")}
          title={data.stats.low_annotator_files > 0 ? "Click to review under-annotated files" : undefined}
        >
          <Flex justify="space-between" align="center" mb={1}>
            <Text fontSize="sm" color="fg.muted">Under-Annotated</Text>
            {data.stats.low_annotator_files > 0 && (
              <AlertTriangle size={14} color="var(--chakra-colors-orange-400)" />
            )}
          </Flex>
          <Text
            fontSize="3xl"
            fontWeight="bold"
            color={data.stats.low_annotator_files > 0 ? "orange.400" : "fg.muted"}
          >
            {data.stats.low_annotator_files.toLocaleString()}
          </Text>
          <Text fontSize="10px" color="fg.subtle" mt={1}>files need ≥2 annotators</Text>
        </Box>
      </Grid>

      <Grid templateColumns="3fr 2fr" gap={6} mb={8}>
        {/* Recent activity */}
        <Box bg="bg.subtle" borderWidth="1px" borderColor="border" rounded="lg" overflow="hidden">
          <Box px={5} py={4} borderBottomWidth="1px" borderColor="border">
            <Text fontWeight="semibold" color="fg">Recent Activity</Text>
          </Box>
          <Table.Root size="sm">
            <Table.Header>
              <Table.Row>
                {["File", "Annotator", "Task", "Status", "When"].map((h) => (
                  <Table.ColumnHeader key={h} color="fg.muted" fontSize="xs" px={4} py={3}>{h}</Table.ColumnHeader>
                ))}
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {data.recent_activity.map((r) => (
                <Table.Row key={r.id} _hover={{ bg: "bg.muted" }}>
                  <Table.Cell px={4} py={3}>
                    <Text fontSize="sm" color="fg" fontFamily="mono">{r.filename.replace(/\.[^.]+$/, "")}</Text>
                  </Table.Cell>
                  <Table.Cell px={4} py={3}>
                    <Text fontSize="sm" color="fg">{r.annotator}</Text>
                  </Table.Cell>
                  <Table.Cell px={4} py={3}>
                    <Text fontSize="sm" color="fg" textTransform="capitalize">{r.task_type}</Text>
                  </Table.Cell>
                  <Table.Cell px={4} py={3}>{statusBadge(r.status)}</Table.Cell>
                  <Table.Cell px={4} py={3}>
                    <Text fontSize="xs" color="fg.muted">{timeAgo(r.created_at)}</Text>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        </Box>

        {/* Dataset progress */}
        <Box bg="bg.subtle" borderWidth="1px" borderColor="border" rounded="lg" overflow="hidden">
          <Box px={5} py={4} borderBottomWidth="1px" borderColor="border">
            <Text fontWeight="semibold" color="fg">Progress by Dataset</Text>
          </Box>
          <Box px={5} py={4}>
            {data.dataset_progress.length === 0 ? (
              <Text fontSize="sm" color="fg.muted" fontStyle="italic">No data yet.</Text>
            ) : (
              data.dataset_progress.map((dp) => (
                <Box
                  key={dp.dataset_id ?? "unassigned"}
                  mb={5}
                  cursor={dp.dataset_id != null ? "pointer" : "default"}
                  onClick={() => dp.dataset_id != null && router.push(`/admin/datasets/${dp.dataset_id}`)}
                  _hover={dp.dataset_id != null ? { opacity: 0.8 } : {}}
                  transition="opacity 0.15s"
                >
                  <Flex justify="space-between" mb={1} align="center">
                    <Flex align="center" gap={1.5}>
                      <Database
                        size={11}
                        color={dp.dataset_id != null
                          ? "var(--chakra-colors-blue-400)"
                          : "var(--chakra-colors-fg-muted)"}
                      />
                      <Text fontSize="sm" color={dp.dataset_id != null ? "fg" : "fg.muted"}>
                        {dp.dataset_name}
                      </Text>
                    </Flex>
                    <Text fontSize="xs" color="fg.muted">
                      {dp.total_files} file{dp.total_files !== 1 ? "s" : ""}
                    </Text>
                  </Flex>
                  <Flex align="center" gap={3}>
                    <Progress.Root
                      value={Math.round(dp.completion_rate * 100)}
                      flex={1}
                      size="sm"
                      colorPalette={dp.dataset_id != null ? "blue" : "gray"}
                    >
                      <Progress.Track rounded="full">
                        <Progress.Range />
                      </Progress.Track>
                    </Progress.Root>
                    <Text fontSize="xs" color="fg.muted" w="32px" textAlign="right">
                      {Math.round(dp.completion_rate * 100)}%
                    </Text>
                  </Flex>
                  {dp.total_assignments > 0 && (
                    <Text fontSize="10px" color="fg.muted" mt={0.5}>
                      {dp.completed_assignments}/{dp.total_assignments} assignments done
                    </Text>
                  )}
                </Box>
              ))
            )}
          </Box>
        </Box>
      </Grid>

      {/* Task breakdown */}
      <Box bg="bg.subtle" borderWidth="1px" borderColor="border" rounded="lg" overflow="hidden" mb={8}>
        <Box px={5} py={4} borderBottomWidth="1px" borderColor="border">
          <Text fontWeight="semibold" color="fg">Task Breakdown</Text>
          <Text fontSize="xs" color="fg.muted">Completion rate per task type</Text>
        </Box>
        <Grid templateColumns="repeat(3, 1fr)" gap={0} px={5} py={5}>
          {(["speaker", "transcription", "emotion"] as const).map((type, i) => {
            const info = data.task_breakdown[type] ?? { total: 0, done: 0 };
            const rate = info.total > 0 ? Math.round((info.done / info.total) * 100) : 0;
            const colors: Record<string, string> = { speaker: "blue", transcription: "purple", emotion: "orange" };
            return (
              <Box
                key={type}
                px={5} py={4}
                borderLeftWidth={i > 0 ? "1px" : "0"}
                borderColor="border"
              >
                <Text fontSize="xs" color="fg.muted" textTransform="capitalize" mb={1}>{type}</Text>
                <Text fontSize="2xl" fontWeight="bold" color={`${colors[type]}.400`}>{rate}%</Text>
                <Progress.Root value={rate} size="xs" colorPalette={colors[type]} mt={2} mb={1}>
                  <Progress.Track rounded="full"><Progress.Range /></Progress.Track>
                </Progress.Root>
                <Text fontSize="10px" color="fg.subtle">{info.done} / {info.total} assignments done</Text>
              </Box>
            );
          })}
        </Grid>
      </Box>

      {/* Annotator summary */}
      <Box bg="bg.subtle" borderWidth="1px" borderColor="border" rounded="lg" overflow="hidden">
        <Box px={5} py={4} borderBottomWidth="1px" borderColor="border">
          <Text fontWeight="semibold" color="fg">Annotator Summary</Text>
        </Box>
        <Table.Root size="sm">
          <Table.Header>
            <Table.Row>
              {["Annotator", "Assigned", "Completed", "Status"].map((h) => (
                <Table.ColumnHeader key={h} color="fg.muted" fontSize="xs" px={4} py={3}>{h}</Table.ColumnHeader>
              ))}
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {data.annotator_summary.map((a) => (
              <Table.Row key={a.id} _hover={{ bg: "bg.muted" }}>
                <Table.Cell px={4} py={3}>
                  <Text fontSize="sm" color="fg">{a.username}</Text>
                </Table.Cell>
                <Table.Cell px={4} py={3}>
                  <Text fontSize="sm" color="fg">{a.assigned}</Text>
                </Table.Cell>
                <Table.Cell px={4} py={3}>
                  <Text fontSize="sm" color="green.400">{a.completed}</Text>
                </Table.Cell>
                <Table.Cell px={4} py={3}>
                  <Badge colorPalette={a.is_active ? "green" : "red"} size="sm">
                    {a.is_active ? "Active" : "Disabled"}
                  </Badge>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      </Box>
    </Box>
  );
}
