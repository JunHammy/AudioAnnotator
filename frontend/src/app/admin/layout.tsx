"use client";

import { Flex, Box } from "@chakra-ui/react";
import { AuthGuard } from "@/components/AuthGuard";
import { Sidebar } from "@/components/Sidebar";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard role="admin">
      <Flex minH="100vh" bg="bg">
        <Sidebar role="admin" />
        <Box flex={1} overflow="auto">
          {children}
        </Box>
      </Flex>
    </AuthGuard>
  );
}
