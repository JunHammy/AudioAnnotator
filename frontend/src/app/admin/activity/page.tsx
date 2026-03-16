"use client";

import { useEffect, useState } from "react";
import { Badge, Box, Flex, Heading, Table, Text } from "@chakra-ui/react";
import { RefreshCw } from "lucide-react";
import { Button } from "@chakra-ui/react";
import api from "@/lib/axios";

interface ActivityEntry {
  id: number;
  action: string;
  resource_type: string | null;
  resource_id: number | null;
  details: Record<string, any> | null;
  created_at: string | null;
  username: string | null;
  user_role: string | null;
}

const ACTION_COLORS: Record<string, string> = {
  upload_audio:       "blue",
  delete_audio:       "red",
  create_user:        "green",
  assign_task:        "purple",
  assign_task_batch:  "purple",
  finalize_emotion:   "orange",
};

const ACTION_LABELS: Record<string, string> = {
  upload_audio:       "Upload Audio",
  delete_audio:       "Delete Audio",
  create_user:        "Create User",
  assign_task:        "Assign Task",
  assign_task_batch:  "Assign Tasks (Batch)",
  finalize_emotion:   "Finalize Emotion",
};

function formatDetails(action: string, details: Record<string, any> | null): string {
  if (!details) return "—";
  if (action === "upload_audio")
    return `${details.filename}${details.language ? ` · ${details.language}` : ""}${details.dataset_id ? ` · dataset ${details.dataset_id}` : ""}`;
  if (action === "delete_audio")
    return details.filename ?? "—";
  if (action === "create_user")
    return `${details.username} (${details.role})`;
  if (action === "assign_task")
    return `file #${details.audio_file_id} → annotator #${details.annotator_id} · ${details.task_type}`;
  if (action === "assign_task_batch")
    return `file #${details.audio_file_id} → annotator #${details.annotator_id} · ${(details.task_types ?? []).join(", ")}`;
  return JSON.stringify(details);
}

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
}

export default function ActivityLogPage() {
  const [entries,  setEntries]  = useState<ActivityEntry[]>([]);
  const [loading,  setLoading]  = useState(true);

  async function load() {
    setLoading(true);
    try {
      const res = await api.get("/api/admin/activity?limit=200");
      setEntries(res.data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <Box p={8} maxW="1100px">
      <Flex justify="space-between" align="center" mb={6}>
        <Box>
          <Heading size="lg" color="fg" mb={1}>Activity Log</Heading>
          <Text color="fg.muted">Admin actions across the platform — last 200 entries</Text>
        </Box>
        <Button size="sm" variant="outline" onClick={load} loading={loading}>
          <RefreshCw size={14} />
          Refresh
        </Button>
      </Flex>

      <Box bg="bg.subtle" borderWidth="1px" borderColor="border" rounded="lg" overflow="hidden">
        {loading ? (
          <Box px={5} py={10} textAlign="center"><Text color="fg.muted">Loading…</Text></Box>
        ) : entries.length === 0 ? (
          <Box px={5} py={10} textAlign="center"><Text color="fg.muted">No activity recorded yet.</Text></Box>
        ) : (
          <Table.Root size="sm">
            <Table.Header>
              <Table.Row>
                {["Time", "Admin", "Action", "Details"].map(h => (
                  <Table.ColumnHeader key={h} color="fg.muted" fontSize="xs" px={4} py={3}>{h}</Table.ColumnHeader>
                ))}
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {entries.map(e => (
                <Table.Row key={e.id} _hover={{ bg: "bg.muted" }}>
                  <Table.Cell px={4} py={2}>
                    <Text fontSize="xs" color="fg.muted" whiteSpace="nowrap">{formatTime(e.created_at)}</Text>
                  </Table.Cell>
                  <Table.Cell px={4} py={2}>
                    <Flex align="center" gap={1.5}>
                      <Text fontSize="sm" color="fg">{e.username ?? "—"}</Text>
                      {e.user_role && (
                        <Badge colorPalette={e.user_role === "admin" ? "purple" : "blue"} size="xs">
                          {e.user_role}
                        </Badge>
                      )}
                    </Flex>
                  </Table.Cell>
                  <Table.Cell px={4} py={2}>
                    <Badge colorPalette={ACTION_COLORS[e.action] ?? "gray"} size="sm">
                      {ACTION_LABELS[e.action] ?? e.action}
                    </Badge>
                  </Table.Cell>
                  <Table.Cell px={4} py={2}>
                    <Text fontSize="xs" color="fg.muted" fontFamily="mono">
                      {formatDetails(e.action, e.details)}
                    </Text>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        )}
      </Box>
    </Box>
  );
}
