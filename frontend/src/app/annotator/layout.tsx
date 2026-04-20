"use client";

import { useState } from "react";
import { Box, Flex, Text } from "@chakra-ui/react";
import { Menu } from "lucide-react";
import { AuthGuard } from "@/components/AuthGuard";
import { Sidebar } from "@/components/Sidebar";

export default function AnnotatorLayout({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <AuthGuard role="annotator">
      <Flex direction="column" h="100vh" overflow="hidden" bg="bg">
        {/* Mobile top bar */}
        <Flex
          display={{ base: "flex", md: "none" }}
          h="14"
          px={4}
          align="center"
          gap={3}
          bg="bg.subtle"
          borderBottomWidth="1px"
          borderColor="border"
          flexShrink={0}
        >
          <Box
            as="button"
            onClick={() => setMobileOpen(true)}
            color="fg.muted"
            display="flex"
            alignItems="center"
            p={1}
          >
            <Menu size={20} />
          </Box>
          <Text fontWeight="bold" fontSize="sm" color="fg">AudioAnnotator</Text>
        </Flex>

        {/* Sidebar + content */}
        <Flex flex={1} overflow="hidden">
          <Sidebar role="annotator" mobileOpen={mobileOpen} onMobileClose={() => setMobileOpen(false)} />
          <Box flex={1} overflow="hidden">
            {children}
          </Box>
        </Flex>
      </Flex>
    </AuthGuard>
  );
}
