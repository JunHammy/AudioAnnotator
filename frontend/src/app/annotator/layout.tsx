"use client";

import { Flex, Box } from "@chakra-ui/react";
import { AuthGuard } from "@/components/AuthGuard";
import { Sidebar } from "@/components/Sidebar";

export default function AnnotatorLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard role="annotator">
      <Flex h="100vh" overflow="hidden" bg="bg">
        <Sidebar role="annotator" />
        <Box flex={1} overflowY="auto">
          {children}
        </Box>
      </Flex>
    </AuthGuard>
  );
}
