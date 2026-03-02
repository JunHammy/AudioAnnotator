"use client";

import { Box, Flex, Text, VStack } from "@chakra-ui/react";
import {
  BarChart2,
  CheckSquare,
  ClipboardList,
  LogOut,
  Mic2,
  ListTodo,
  Upload,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import ToastWizard from "@/lib/toastWizard";

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
}

const ADMIN_NAV: NavItem[] = [
  { label: "Dashboard",          href: "/admin",               icon: <BarChart2   size={18} /> },
  { label: "Upload Files",        href: "/admin/upload",        icon: <Upload      size={18} /> },
  { label: "Manage Annotators",   href: "/admin/annotators",    icon: <Users       size={18} /> },
  { label: "Assign Tasks",        href: "/admin/assignments",   icon: <ClipboardList size={18} /> },
  { label: "Review & Finalize",   href: "/admin/review",        icon: <CheckSquare size={18} /> },
];

const ANNOTATOR_NAV: NavItem[] = [
  { label: "My Tasks",        href: "/annotator",         icon: <ListTodo size={18} /> },
  { label: "Annotation View", href: "/annotator/annotate", icon: <Mic2     size={18} /> },
];

export function Sidebar({ role }: { role: "admin" | "annotator" }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();

  const nav = role === "admin" ? ADMIN_NAV : ANNOTATOR_NAV;

  function handleLogout() {
    logout();
    ToastWizard.standard("success", "Logged out", "See you next time!", 3000, true);
    router.replace("/login");
  }

  return (
    <Flex
      direction="column"
      w="240px"
      minH="100vh"
      bg="bg.subtle"
      borderRightWidth="1px"
      borderColor="border"
      flexShrink={0}
    >
      {/* Logo / App name */}
      <Box px={5} py={5} borderBottomWidth="1px" borderColor="border">
        <Text fontWeight="bold" fontSize="md" color="fg" letterSpacing="tight">
          AudioAnnotator
        </Text>
        <Text fontSize="xs" color="fg.muted" mt={0.5}>
          {role === "admin" ? "Admin Panel" : "Annotator"}
        </Text>
      </Box>

      {/* Nav items */}
      <VStack gap={1} align="stretch" px={3} py={4} flex={1}>
        {nav.map((item) => {
          const isActive =
            item.href === "/admin" || item.href === "/annotator"
              ? pathname === item.href
              : pathname.startsWith(item.href);

          return (
            <Link key={item.href} href={item.href} style={{ textDecoration: "none" }}>
              <Flex
                align="center"
                gap={3}
                px={3}
                py={2}
                rounded="md"
                fontSize="sm"
                fontWeight={isActive ? "semibold" : "normal"}
                color={isActive ? "blue.400" : "fg.muted"}
                bg={isActive ? "bg.muted" : "transparent"}
                _hover={{ bg: "bg.muted", color: "fg" }}
                transition="all 0.15s"
                cursor="pointer"
              >
                {item.icon}
                {item.label}
              </Flex>
            </Link>
          );
        })}
      </VStack>

      {/* User + Logout */}
      <Box px={3} py={4} borderTopWidth="1px" borderColor="border">
        <Flex
          align="center"
          gap={3}
          px={3}
          py={2}
          mb={1}
          rounded="md"
          bg="bg.muted"
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
          <Box minW={0}>
            <Text fontSize="sm" fontWeight="medium" color="fg" truncate>
              {user?.username}
            </Text>
            <Text fontSize="xs" color="fg.muted" textTransform="capitalize">
              {user?.role}
            </Text>
          </Box>
        </Flex>

        <Flex
          align="center"
          gap={3}
          px={3}
          py={2}
          rounded="md"
          fontSize="sm"
          color="fg.muted"
          cursor="pointer"
          _hover={{ bg: "bg.muted", color: "red.400" }}
          transition="all 0.15s"
          onClick={handleLogout}
        >
          <LogOut size={18} />
          Log out
        </Flex>
      </Box>
    </Flex>
  );
}
