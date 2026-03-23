"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  Box,
  Button,
  Dialog,
  Flex,
  HStack,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Bell, BellRing, CheckCheck, ClipboardList, MessageSquare } from "lucide-react";
import { useRouter } from "next/navigation";
import api from "@/lib/axios";
import { useSSE } from "@/context/sse";

interface Notification {
  id: number;
  type: string;             // "assignment" | "admin_response"
  message: string;
  audio_file_id: number | null;
  read: boolean;
  created_at: string;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

interface Props {
  collapsed: boolean;
}

export function NotificationBell({ collapsed }: Props) {
  const router = useRouter();
  const { on } = useSSE();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);

  const unreadCount = notifications.filter(n => !n.read).length;

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await api.get("/api/notifications/");
      setNotifications(res.data);
    } catch {
      // Silent — don't disrupt the UI if notifications fail
    }
  }, []);

  // Fetch on mount + keep a fallback 60s poll
  useEffect(() => {
    fetchNotifications();
    const t = setInterval(fetchNotifications, 60_000);
    return () => clearInterval(t);
  }, [fetchNotifications]);

  // Real-time updates via SSE
  useEffect(() => {
    // New assignment → server created a notification row; refetch to get it
    const offAssignment = on("assignment_created", () => {
      fetchNotifications();
    });
    // Admin response → server broadcast the notification data inline
    const offNotif = on("notification", (data) => {
      const d = data as { notif_type: string; message: string; audio_file_id: number | null };
      setNotifications(prev => [{
        id: Date.now(),          // temporary id until next refetch
        type: d.notif_type,
        message: d.message,
        audio_file_id: d.audio_file_id,
        read: false,
        created_at: new Date().toISOString(),
      }, ...prev]);
    });
    return () => { offAssignment(); offNotif(); };
  }, [on, fetchNotifications]);

  const markAllRead = async () => {
    try {
      await api.patch("/api/notifications/mark-all-read");
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    } catch {}
  };

  const handleNotificationClick = async (n: Notification) => {
    // Mark as read
    if (!n.read) {
      try {
        await api.patch(`/api/notifications/${n.id}/read`);
        setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, read: true } : x));
      } catch {}
    }
    // Navigate if linked to a file
    if (n.audio_file_id) {
      setOpen(false);
      router.push(`/annotator/annotate?file=${n.audio_file_id}`);
    }
  };

  const openDialog = async () => {
    setOpen(true);
    setLoading(true);
    await fetchNotifications();
    setLoading(false);
  };

  return (
    <>
      {/* Bell button — styled to match sidebar nav items */}
      <Flex
        align="center"
        justify={collapsed ? "center" : "flex-start"}
        gap={collapsed ? 0 : 3}
        px={collapsed ? 0 : 3}
        py={2}
        rounded="md"
        fontSize="sm"
        color={unreadCount > 0 ? "blue.400" : "fg.muted"}
        cursor="pointer"
        _hover={{ bg: "bg.muted", color: "fg" }}
        transition="all 0.15s"
        onClick={openDialog}
        title={collapsed ? `Notifications${unreadCount > 0 ? ` (${unreadCount})` : ""}` : undefined}
        overflow="hidden"
        position="relative"
      >
        <Box flexShrink={0} position="relative">
          {unreadCount > 0 ? <BellRing size={18} /> : <Bell size={18} />}
          {unreadCount > 0 && (
            <Box
              position="absolute"
              top="-4px"
              right="-4px"
              bg="red.500"
              color="white"
              fontSize="8px"
              fontWeight="bold"
              minW="14px"
              h="14px"
              rounded="full"
              display="flex"
              alignItems="center"
              justifyContent="center"
              px="2px"
            >
              {unreadCount > 9 ? "9+" : unreadCount}
            </Box>
          )}
        </Box>
        {!collapsed && (
          <>
            <Text fontSize="sm" whiteSpace="nowrap" overflow="hidden" textOverflow="ellipsis" flex={1}>
              Notifications
            </Text>
            {unreadCount > 0 && (
              <Badge colorPalette="blue" size="sm" flexShrink={0}>{unreadCount}</Badge>
            )}
          </>
        )}
      </Flex>

      {/* Notification panel dialog */}
      <Dialog.Root open={open} onOpenChange={({ open }) => setOpen(open)}>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content
            bg="bg.subtle"
            borderWidth="1px"
            borderColor="border"
            rounded="lg"
            maxW="420px"
            w="full"
            maxH="80vh"
            display="flex"
            flexDir="column"
          >
            <Dialog.Header borderBottomWidth="1px" borderColor="border" pb={3} flexShrink={0}>
              <HStack justify="space-between" align="center">
                <Dialog.Title fontSize="md" color="fg">Notifications</Dialog.Title>
                {unreadCount > 0 && (
                  <Button size="xs" variant="ghost" colorPalette="blue" onClick={markAllRead}>
                    <CheckCheck size={13} />
                    Mark all read
                  </Button>
                )}
              </HStack>
            </Dialog.Header>

            <Dialog.Body flex={1} overflowY="auto" pt={2} pb={3} px={3}
              css={{
                "&::-webkit-scrollbar": { width: "4px" },
                "&::-webkit-scrollbar-thumb": { background: "#4a4c54", borderRadius: "999px" },
              }}
            >
              {loading ? (
                <Flex justify="center" py={8}><Spinner size="sm" /></Flex>
              ) : notifications.length === 0 ? (
                <Flex direction="column" align="center" py={10} gap={2} color="fg.muted">
                  <Bell size={32} opacity={0.3} />
                  <Text fontSize="sm">No notifications yet</Text>
                </Flex>
              ) : (
                <VStack align="stretch" gap={1}>
                  {notifications.map(n => (
                    <Flex
                      key={n.id}
                      gap={3}
                      px={3}
                      py={2.5}
                      rounded="md"
                      bg={n.read ? "transparent" : "blue.900"}
                      borderWidth="1px"
                      borderColor={n.read ? "transparent" : "blue.800"}
                      cursor={n.audio_file_id ? "pointer" : "default"}
                      _hover={n.audio_file_id ? { bg: n.read ? "bg.muted" : "blue.800" } : {}}
                      transition="all 0.1s"
                      onClick={() => handleNotificationClick(n)}
                      align="flex-start"
                    >
                      {/* Icon */}
                      <Box
                        color={n.read ? "fg.muted" : n.type === "admin_response" ? "blue.300" : "teal.300"}
                        flexShrink={0}
                        mt="2px"
                      >
                        {n.type === "admin_response"
                          ? <MessageSquare size={15} />
                          : <ClipboardList size={15} />
                        }
                      </Box>

                      {/* Content */}
                      <Box flex={1} minW={0}>
                        <Text
                          fontSize="sm"
                          color={n.read ? "fg.muted" : "fg"}
                          fontWeight={n.read ? "normal" : "medium"}
                          lineClamp={2}
                        >
                          {n.message}
                        </Text>
                        <HStack mt={0.5} gap={2}>
                          <Text fontSize="10px" color="fg.subtle" suppressHydrationWarning>
                            {timeAgo(n.created_at)}
                          </Text>
                          {n.audio_file_id && (
                            <Text fontSize="10px" color="blue.400">→ open file</Text>
                          )}
                        </HStack>
                      </Box>

                      {/* Unread dot */}
                      {!n.read && (
                        <Box w="6px" h="6px" rounded="full" bg="blue.400" flexShrink={0} mt="6px" />
                      )}
                    </Flex>
                  ))}
                </VStack>
              )}
            </Dialog.Body>
          </Dialog.Content>
        </Dialog.Positioner>
      </Dialog.Root>
    </>
  );
}
