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
  link_json:          "cyan",
  create_user:        "green",
  update_user:        "yellow",
  delete_user:        "red",
  assign_task:        "purple",
  assign_task_batch:  "purple",
  complete_task:      "teal",
  finalize_emotion:   "orange",
};

const ACTION_LABELS: Record<string, string> = {
  upload_audio:       "Upload Audio",
  delete_audio:       "Delete Audio",
  link_json:          "Link JSON",
  create_user:        "Create User",
  update_user:        "Update User",
  delete_user:        "Delete User",
  assign_task:        "Assign Task",
  assign_task_batch:  "Assign Tasks (Batch)",
  complete_task:      "Complete Task",
  finalize_emotion:   "Finalize Emotion",
};

function formatDetails(action: string, details: Record<string, any> | null): string {
  if (!details) return "—";
  switch (action) {
    case "upload_audio":
      return `${details.filename}${details.language ? ` · ${details.language}` : ""}${details.dataset_id ? ` · dataset #${details.dataset_id}` : ""}`;
    case "delete_audio":
      return details.filename ?? "—";
    case "link_json":
      return `${details.filename} · ${details.json_type}`;
    case "create_user":
      return `${details.username} (${details.role})`;
    case "update_user": {
      const parts: string[] = [];
      if (details.old_username && details.new_username)
        parts.push(`rename ${details.old_username} → ${details.new_username}`);
      if (details.is_active !== undefined)
        parts.push(details.is_active ? "enabled" : "disabled");
      if (details.role)
        parts.push(`role → ${details.role}`);
      if (details.password_reset)
        parts.push("password reset");
      return parts.length ? parts.join(" · ") : (details.username ?? "—");
    }
    case "delete_user":
      return `${details.username} (${details.role})`;
    case "assign_task":
      return `file #${details.audio_file_id} → annotator #${details.annotator_id} · ${details.task_type}`;
    case "assign_task_batch":
      return `file #${details.audio_file_id} → annotator #${details.annotator_id} · ${(details.task_types ?? []).join(", ")}`;
    case "complete_task":
      return `file #${details.audio_file_id} · ${details.task_type}`;
    default:
      return JSON.stringify(details);
  }
}

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
}

type RoleFilter = "all" | "admin" | "annotator";

export default function ActivityLogPage() {
  const [entries,    setEntries]    = useState<ActivityEntry[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");

  async function load() {
    setLoading(true);
    try {
      const res = await api.get("/api/admin/activity?limit=500");
      setEntries(res.data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const filtered = roleFilter === "all"
    ? entries
    : entries.filter(e => e.user_role === roleFilter);

  return (
    <Box p={8} maxW="1200px">
      <Flex justify="space-between" align="center" mb={6}>
        <Box>
          <Heading size="lg" color="fg" mb={1}>Activity Log</Heading>
          <Text color="fg.muted">All admin and annotator actions — last 500 entries</Text>
        </Box>
        <Button size="sm" variant="outline" onClick={load} loading={loading}>
          <RefreshCw size={14} />
          Refresh
        </Button>
      </Flex>

      {/* Role filter tabs */}
      <Flex gap={2} mb={4}>
        {(["all", "admin", "annotator"] as RoleFilter[]).map(r => (
          <Box
            key={r}
            as="button"
            px={3} py={1} fontSize="sm" rounded="md" borderWidth="1px"
            cursor="pointer"
            borderColor={roleFilter === r ? "blue.400" : "border"}
            bg={roleFilter === r ? "blue.900" : "bg.muted"}
            color={roleFilter === r ? "blue.300" : "fg.muted"}
            _hover={{ borderColor: "blue.400", color: "blue.300" }}
            transition="all 0.1s"
            onClick={() => setRoleFilter(r)}
          >
            {r === "all" ? "All" : r.charAt(0).toUpperCase() + r.slice(1)}
          </Box>
        ))}
        <Text fontSize="sm" color="fg.muted" alignSelf="center" ml={2}>
          {filtered.length} entries
        </Text>
      </Flex>

      <Box bg="bg.subtle" borderWidth="1px" borderColor="border" rounded="lg" overflow="hidden">
        {loading ? (
          <Box px={5} py={10} textAlign="center"><Text color="fg.muted">Loading…</Text></Box>
        ) : filtered.length === 0 ? (
          <Box px={5} py={10} textAlign="center"><Text color="fg.muted">No activity recorded yet.</Text></Box>
        ) : (
          <Table.Root size="sm">
            <Table.Header>
              <Table.Row>
                {["Time", "User", "Action", "Details"].map(h => (
                  <Table.ColumnHeader key={h} color="fg.muted" fontSize="xs" px={4} py={3}>{h}</Table.ColumnHeader>
                ))}
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {filtered.map(e => (
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
