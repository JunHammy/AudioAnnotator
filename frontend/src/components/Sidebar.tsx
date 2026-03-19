"use client";

import { useEffect, useState } from "react";
import { Box, Flex, Text, VStack } from "@chakra-ui/react";
import {
  BarChart2,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Database,
  LogOut,
  Mic2,
  ListTodo,
  ScrollText,
  Tag,
  Upload,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import ToastWizard from "@/lib/toastWizard";
import { NotificationBell } from "@/components/NotificationBell";

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
}

const ADMIN_NAV: NavItem[] = [
  { label: "Dashboard",           href: "/admin",                    icon: <BarChart2     size={18} /> },
  { label: "Upload Files",        href: "/admin/upload",             icon: <Upload        size={18} /> },
  { label: "Datasets",            href: "/admin/datasets",           icon: <Database      size={18} /> },
  { label: "Manage Accounts",     href: "/admin/annotators",         icon: <Users         size={18} /> },
  { label: "Assign Tasks",        href: "/admin/assignments",        icon: <ClipboardList size={18} /> },
  { label: "Review & Finalize",   href: "/admin/review",             icon: <CheckSquare   size={18} /> },
  { label: "Bracket Words",       href: "/admin/bracket-words",      icon: <Tag           size={18} /> },
  { label: "Activity Log",        href: "/admin/activity",           icon: <ScrollText    size={18} /> },
];

const ANNOTATOR_NAV: NavItem[] = [
  { label: "My Tasks",        href: "/annotator",          icon: <ListTodo size={18} /> },
  { label: "Annotation View", href: "/annotator/annotate", icon: <Mic2     size={18} /> },
];

const STORAGE_KEY = "sidebar-collapsed";

export function Sidebar({ role }: { role: "admin" | "annotator" }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();

  const [collapsed, setCollapsed] = useState(false);

  // Restore persisted state on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored !== null) setCollapsed(stored === "true");
    } catch {}
  }, []);

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    try { localStorage.setItem(STORAGE_KEY, String(next)); } catch {}
  }

  function handleLogout() {
    logout();
    ToastWizard.standard("success", "Logged out", "See you next time!", 3000, true);
    router.replace("/login");
  }

  const nav = role === "admin" ? ADMIN_NAV : ANNOTATOR_NAV;
  const w = collapsed ? "60px" : "240px";

  return (
    <Flex
      direction="column"
      w={w}
      minW={w}
      h="100vh"
      overflowX="hidden"
      overflowY="auto"
      bg="bg.subtle"
      borderRightWidth="1px"
      borderColor="border"
      flexShrink={0}
      transition="width 0.2s ease, min-width 0.2s ease"
    >
      {/* Logo / App name + collapse toggle */}
      <Flex
        align="center"
        justify={collapsed ? "center" : "space-between"}
        px={collapsed ? 0 : 4}
        py={4}
        borderBottomWidth="1px"
        borderColor="border"
        overflow="hidden"
        flexShrink={0}
      >
        {!collapsed && (
          <Box>
            <Text fontWeight="bold" fontSize="md" color="fg" letterSpacing="tight" whiteSpace="nowrap">
              AudioAnnotator
            </Text>
            <Text fontSize="xs" color="fg.muted" mt={0.5} whiteSpace="nowrap">
              {role === "admin" ? "Admin Panel" : "Annotator"}
            </Text>
          </Box>
        )}
        <Flex
          as="button"
          align="center"
          justify="center"
          w="7"
          h="7"
          rounded="md"
          color="fg.muted"
          cursor="pointer"
          flexShrink={0}
          _hover={{ bg: "bg.muted", color: "fg" }}
          transition="all 0.15s"
          onClick={toggleCollapsed}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </Flex>
      </Flex>

      {/* Nav items */}
      <VStack gap={1} align="stretch" px={collapsed ? "6px" : 3} py={4} flex={1}>
        {role === "annotator" && (
          <NotificationBell collapsed={collapsed} />
        )}
        {nav.map((item) => {
          const isActive =
            item.href === "/admin" || item.href === "/annotator"
              ? pathname === item.href
              : pathname.startsWith(item.href);

          return (
            <Link key={item.href} href={item.href} style={{ textDecoration: "none" }}>
              <Flex
                align="center"
                justify={collapsed ? "center" : "flex-start"}
                gap={collapsed ? 0 : 3}
                px={collapsed ? 0 : 3}
                py={2}
                rounded="md"
                fontSize="sm"
                fontWeight={isActive ? "semibold" : "normal"}
                color={isActive ? "blue.400" : "fg.muted"}
                bg={isActive ? "bg.muted" : "transparent"}
                _hover={{ bg: "bg.muted", color: "fg" }}
                transition="all 0.15s"
                cursor="pointer"
                title={collapsed ? item.label : undefined}
                overflow="hidden"
              >
                <Box flexShrink={0}>{item.icon}</Box>
                {!collapsed && (
                  <Text fontSize="sm" whiteSpace="nowrap" overflow="hidden" textOverflow="ellipsis">
                    {item.label}
                  </Text>
                )}
              </Flex>
            </Link>
          );
        })}
      </VStack>

      {/* User + Logout */}
      <Box px={collapsed ? "6px" : 3} py={4} borderTopWidth="1px" borderColor="border">
        {/* Avatar / user card */}
        <Flex
          align="center"
          justify={collapsed ? "center" : "flex-start"}
          gap={collapsed ? 0 : 3}
          px={collapsed ? 0 : 3}
          py={2}
          mb={1}
          rounded="md"
          bg="bg.muted"
          overflow="hidden"
          title={collapsed ? user?.username : undefined}
        >
          <Box
            w="7"
            h="7"
            rounded="full"
            bg="blue.500"
            display="flex"
            alignItems="center"
            justifyContent="center"
            fontSize="xs"
            fontWeight="bold"
            color="white"
            flexShrink={0}
          >
            {user?.username?.[0]?.toUpperCase() ?? "?"}
          </Box>
          {!collapsed && (
            <Box minW={0}>
              <Text fontSize="sm" fontWeight="medium" color="fg" truncate whiteSpace="nowrap">
                {user?.username}
              </Text>
              <Text fontSize="xs" color="fg.muted" textTransform="capitalize" whiteSpace="nowrap">
                {user?.role}
              </Text>
            </Box>
          )}
        </Flex>

        {/* Logout */}
        <Flex
          align="center"
          justify={collapsed ? "center" : "flex-start"}
          gap={collapsed ? 0 : 3}
          px={collapsed ? 0 : 3}
          py={2}
          rounded="md"
          fontSize="sm"
          color="fg.muted"
          cursor="pointer"
          _hover={{ bg: "bg.muted", color: "red.400" }}
          transition="all 0.15s"
          onClick={handleLogout}
          title={collapsed ? "Log out" : undefined}
          overflow="hidden"
        >
          <Box flexShrink={0}><LogOut size={18} /></Box>
          {!collapsed && <Text fontSize="sm" whiteSpace="nowrap">Log out</Text>}
        </Flex>
      </Box>
    </Flex>
  );
}
