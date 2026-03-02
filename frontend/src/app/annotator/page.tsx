"use client";

import { Box, Heading, Text } from "@chakra-ui/react";
import { useAuth } from "@/hooks/useAuth";

export default function AnnotatorTasks() {
  const { user } = useAuth();

  return (
    <Box p={8}>
      <Heading size="lg" color="fg" mb={1}>My Tasks</Heading>
      <Text color="fg.muted">Welcome, {user?.username}</Text>
      {/* TODO: Task table with filter buttons */}
    </Box>
  );
}
