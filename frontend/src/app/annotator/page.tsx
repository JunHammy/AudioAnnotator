"use client";

import { Box, Heading, Text } from "@chakra-ui/react";
import { useAuth } from "@/hooks/useAuth";

export default function AnnotatorTasks() {
  const { user } = useAuth();

  return (
    <Box p={8}>
      <Heading mb={2}>My Tasks</Heading>
      <Text color="gray.500">Welcome, {user?.username}</Text>
      {/* TODO: List of assigned files with statuses */}
    </Box>
  );
}
